// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
//
// Changelog translations (#306 follow-up): language-negotiated public serving,
// the bulk LLM translate job (kind "changelog"), auto-translate on publish,
// and the "changelog" permission gating.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { changelogSourceHash, changelogSourceStrings, changelogTargetLangs } from "../../models/changelog-i18n.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { ACTION_RATE_LIMITS } from "../../services/actionratelimit.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, headers?: Record<string, string>, body?: unknown) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data };
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}` };
}

interface PublicEntry {
	_id: string;
	content: string;
	details?: string;
	published: boolean;
	translations?: unknown;
}

interface JobBody {
	status: "running" | "done" | "error";
	kind?: string;
	total: number;
	done: number;
	translated: number;
	skipped: number;
	errors: { page: string; lang: string; message: string }[];
}

function insertEntry(overrides: {
	content: string;
	details?: string;
	published?: boolean;
	createdAt?: Date;
	translations?: object;
}) {
	const _id = new ObjectId();
	return colls.changelogs
		.insertOne({
			_id,
			content: overrides.content,
			...(overrides.details ? { details: overrides.details } : {}),
			published: overrides.published ?? true,
			createdAt: overrides.createdAt ?? new Date(),
			...(overrides.translations ? { translations: overrides.translations } : {}),
		})
		.then(() => _id);
}

describe("Changelog translations (#306 follow-up)", () => {
	const adminId = new ObjectId();
	const changelogAdminId = new ObjectId();
	const pagesAdminId = new ObjectId();
	const userId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let changelogAdminHeaders: Record<string, string>;
	let pagesAdminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	// Fake LLM server, same pattern as the pages/metadata bulk suites: answers
	// every completion with a "[t:<lang>] " marker prefix.
	let llm: http.Server;

	before(async () => {
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: changelogAdminId, adminGrants: ["changelog"] }));
		await colls.users.insertOne(testUser({ _id: pagesAdminId, adminGrants: ["pages"] }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		changelogAdminHeaders = await makeAuthHeaders(changelogAdminId);
		pagesAdminHeaders = await makeAuthHeaders(pagesAdminId);
		userHeaders = await makeAuthHeaders(userId);
		// The suite starts several runs; relax the per-admin hourly cap.
		ACTION_RATE_LIMITS["admin/translate-changelog-bulk"] = { max: 100, windowMs: 60 * 60 * 1000 };

		llm = http.createServer((req, res) => {
			let raw = "";
			req.on("data", (chunk) => (raw += chunk));
			req.on("end", () => {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse is any; fields are defaulted below
				const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
				const user = body.messages.find((m) => m.role === "user")?.content ?? "";
				const lang = / to ([a-z]{2,3})\./.exec(user)?.[1] ?? "??";
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						choices: [{ message: { content: `[t:${lang}] ${user.split("\n\n").at(-1)}` }, finish_reason: "stop" }],
					}),
				);
			});
		});
		await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
		env.translation.apiKey = "test-key";
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen(0, "127.0.0.1") binds a TCP port, so the address is an AddressInfo
		env.translation.baseUrl = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
		env.translation.timeoutMs = 2000;
	});

	after(async () => {
		env.translation.apiKey = "";
		env.translation.baseUrl = "https://openrouter.ai/api/v1";
		env.translation.timeoutMs = 180_000;
		await new Promise((resolve) => llm.close(resolve));
		await db().dropDatabase();
	});

	beforeEach(async () => {
		await colls.changelogs.deleteMany({});
		await colls.settings.deleteMany({ _id: { $regex: "^bulkTranslateJob:" } });
	});

	async function waitForJob(jobId: string, headers = changelogAdminHeaders): Promise<JobBody> {
		for (let i = 0; i < 200; i++) {
			const poll = await api("GET", `/api/admin/changelog/translate-bulk/${jobId}`, headers);
			assert.strictEqual(poll.status, 200, JSON.stringify(poll.data));
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const job = poll.data as JobBody;
			if (job.status !== "running") {
				return job;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.fail(`job ${jobId} still running after 10s`);
	}

	describe("public serving (language negotiation + per-field fallback)", () => {
		it("serves the Accept-Language translation with per-field English fallback, stripping the map", async () => {
			await insertEntry({
				content: "EN one-liner",
				details: "EN details",
				translations: { fr: { content: "FR one-liner" }, de: { content: "DE one-liner", details: "DE details" } },
			});

			const fr = await api("GET", "/api/site/changelog", { "accept-language": "fr-FR,fr;q=0.9" });
			assert.strictEqual(fr.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const [frEntry] = fr.data as PublicEntry[];
			assert.strictEqual(frEntry.content, "FR one-liner");
			assert.strictEqual(frEntry.details, "EN details", "untranslated field falls back to English");
			assert.strictEqual(frEntry.translations, undefined, "the translations map never leaves the api");

			const de = await api("GET", "/api/site/changelog", { "accept-language": "de" });
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const [deEntry] = de.data as PublicEntry[];
			assert.strictEqual(deEntry.content, "DE one-liner");
			assert.strictEqual(deEntry.details, "DE details");

			// No header → English source; the map is stripped there too.
			const en = await api("GET", "/api/site/changelog");
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const [enEntry] = en.data as PublicEntry[];
			assert.strictEqual(enEntry.content, "EN one-liner");
			assert.strictEqual(enEntry.translations, undefined);
		});

		it("the lang cookie (an explicit choice) wins over Accept-Language; unknown languages fall back", async () => {
			await insertEntry({ content: "EN one-liner", translations: { fr: { content: "FR one-liner" } } });

			const cookie = await api("GET", "/api/site/changelog", {
				cookie: "lang=fr",
				"accept-language": "de-DE,de;q=0.9",
			});
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual((cookie.data as PublicEntry[])[0].content, "FR one-liner");

			// Regional tag collapses to its base subtag (pt-BR → pt keys).
			await colls.changelogs.updateMany({}, { $set: { "translations.pt": { content: "PT one-liner" } } });
			const pt = await api("GET", "/api/site/changelog", { "accept-language": "pt-BR" });
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual((pt.data as PublicEntry[])[0].content, "PT one-liner");

			const ja = await api("GET", "/api/site/changelog", { "accept-language": "ja" });
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual((ja.data as PublicEntry[])[0].content, "EN one-liner");
		});

		it("localizes the homepage announcement through the same overlays", async () => {
			await insertEntry({ content: "New games", translations: { fr: { content: "Nouveaux jeux" } } });
			await insertEntry({ content: "Bug fixes", createdAt: new Date(Date.now() - 1000) });

			const res = await api("GET", "/api/site/announcement", { "accept-language": "fr" });
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { content } = res.data as { content: string };
			assert.ok(content.includes("Nouveaux jeux"), content);
			assert.ok(content.includes("Bug fixes"), "untranslated entry falls back to English");
		});
	});

	describe("bulk translate job (kind 'changelog')", () => {
		it("is gated to the 'changelog' permission", async () => {
			// The mount's permission gate answers before auth resolution → 403, not 401.
			assert.strictEqual((await api("POST", "/api/admin/changelog/translate-bulk", undefined, {})).status, 403);
			assert.strictEqual((await api("POST", "/api/admin/changelog/translate-bulk", userHeaders, {})).status, 403);
			// "pages" alone doesn't satisfy the changelog mount.
			assert.strictEqual((await api("POST", "/api/admin/changelog/translate-bulk", pagesAdminHeaders, {})).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/changelog/translate-bulk/x", pagesAdminHeaders)).status, 403);
		});

		it("translates one entry into every target language, stamping the source hash", async () => {
			const id = await insertEntry({ content: "EN one-liner", details: "EN details" });

			const res = await api("POST", "/api/admin/changelog/translate-bulk", changelogAdminHeaders, {
				entryId: id.toHexString(),
			});
			assert.strictEqual(res.status, 202, JSON.stringify(res.data));
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { jobId, total } = res.data as { jobId: string; total: number };
			assert.strictEqual(total, changelogTargetLangs().length);

			const job = await waitForJob(jobId);
			assert.strictEqual(job.status, "done");
			assert.strictEqual(job.kind, "changelog");
			assert.strictEqual(job.translated, total);
			assert.deepEqual(job.errors, []);

			const doc = await colls.changelogs.findOne({ _id: id });
			assert.deepEqual(Object.keys(doc?.translations ?? {}).sort(), [...changelogTargetLangs()].sort());
			assert.strictEqual(doc?.translations?.fr?.content, "[t:fr] EN one-liner");
			assert.strictEqual(doc?.translations?.fr?.details, "[t:fr] EN details");
			assert.strictEqual(
				doc?.translations?.fr?.translatedFrom?.hash,
				changelogSourceHash(changelogSourceStrings(doc ?? {})),
			);
			// The source fields stay untouched.
			assert.strictEqual(doc?.content, "EN one-liner");
		});

		it("a {targetLang} run covers published entries only, skipping fresh and re-translating outdated overlays", async () => {
			const freshHash = changelogSourceHash(changelogSourceStrings({ content: "Fresh entry" }));
			await insertEntry({
				content: "Fresh entry",
				translations: { fr: { content: "Entrée fraîche", translatedFrom: { hash: freshHash } } },
			});
			const outdatedId = await insertEntry({
				content: "Edited entry",
				translations: { fr: { content: "Stale", translatedFrom: { hash: "0000000000000000" } } },
			});
			const missingId = await insertEntry({ content: "Missing entry" });
			await insertEntry({ content: "Draft entry", published: false });

			const res = await api("POST", "/api/admin/changelog/translate-bulk", changelogAdminHeaders, {
				targetLang: "fr",
			});
			assert.strictEqual(res.status, 202);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { jobId, total } = res.data as { jobId: string; total: number };
			assert.strictEqual(total, 2, "outdated + missing; not the fresh one, not the draft");

			const job = await waitForJob(jobId);
			assert.strictEqual(job.status, "done");
			assert.strictEqual(job.translated, 2);

			const outdated = await colls.changelogs.findOne({ _id: outdatedId });
			assert.strictEqual(outdated?.translations?.fr?.content, "[t:fr] Edited entry");
			assert.strictEqual(
				outdated?.translations?.fr?.translatedFrom?.hash,
				changelogSourceHash(changelogSourceStrings(outdated ?? {})),
				"re-translation refreshes the stamp",
			);
			assert.strictEqual(
				(await colls.changelogs.findOne({ _id: missingId }))?.translations?.fr?.content !== undefined,
				true,
			);
			const draft = await colls.changelogs.findOne({ content: "Draft entry" });
			assert.strictEqual(draft?.translations, undefined, "drafts are not translated");
			const fresh = await colls.changelogs.findOne({ content: "Fresh entry" });
			assert.strictEqual(fresh?.translations?.fr?.content, "Entrée fraîche", "fresh overlay untouched");
		});

		it("refuses to translate a draft explicitly, and 404s on a missing entry", async () => {
			const draftId = await insertEntry({ content: "Draft", published: false });
			const draft = await api("POST", "/api/admin/changelog/translate-bulk", changelogAdminHeaders, {
				entryId: draftId.toHexString(),
			});
			assert.strictEqual(draft.status, 400);
			const missing = await api("POST", "/api/admin/changelog/translate-bulk", changelogAdminHeaders, {
				entryId: new ObjectId().toHexString(),
			});
			assert.strictEqual(missing.status, 404);
		});

		it("shows up in the translations overview: jobs table + per-locale coverage cells", async () => {
			const hash = changelogSourceHash(changelogSourceStrings({ content: "Covered" }));
			await insertEntry({
				content: "Covered",
				translations: {
					fr: { content: "Couvert", translatedFrom: { hash } },
					de: { content: "Stale", translatedFrom: { hash: "0000000000000000" } },
					el: { content: "manual, unstamped" },
				},
			});
			await insertEntry({ content: "Uncovered" });
			await insertEntry({ content: "Draft", published: false });

			const res = await api("POST", "/api/admin/changelog/translate-bulk", changelogAdminHeaders, {
				targetLang: "ro",
			});
			assert.strictEqual(res.status, 202);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			await waitForJob((res.data as { jobId: string }).jobId);

			const overview = await api("GET", "/api/admin/translations/overview", adminHeaders);
			assert.strictEqual(overview.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const data = overview.data as {
				changelog: {
					total: number;
					cells: Record<string, { ok: number; outdated: number; missing: number; unknown: number }>;
				};
				jobs: { kind?: string; status: string }[];
			};
			assert.strictEqual(data.changelog.total, 2, "published entries only");
			assert.deepEqual(data.changelog.cells.fr, { ok: 1, outdated: 0, missing: 1, unknown: 0 });
			assert.deepEqual(data.changelog.cells.de, { ok: 0, outdated: 1, missing: 1, unknown: 0 });
			assert.deepEqual(data.changelog.cells.el, { ok: 0, outdated: 0, missing: 1, unknown: 1 });
			assert.deepEqual(data.changelog.cells.ro, { ok: 2, outdated: 0, missing: 0, unknown: 0 }, "just-translated run");
			assert.ok(
				data.jobs.some((j) => j.kind === "changelog" && j.status === "done"),
				"the changelog job is listed",
			);
		});
	});

	describe("auto-translate on publish", () => {
		// The publish hook is fire-and-forget (no job id in the response), so
		// wait on the db: first for the overlays, then for every job doc to
		// turn terminal — a job writes progress after the last overlay lands,
		// and a straggler write would race the next test's cleanup.
		async function settleJobs(): Promise<void> {
			for (let i = 0; i < 200; i++) {
				const running = await colls.settings.countDocuments({
					_id: { $regex: "^bulkTranslateJob:" },
					"value.status": "running",
				});
				if (running === 0) {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.fail("auto-translate jobs never settled");
		}

		async function waitForOverlays(id: ObjectId): Promise<void> {
			for (let i = 0; i < 200; i++) {
				const doc = await colls.changelogs.findOne({ _id: id });
				if (doc && Object.keys(doc.translations ?? {}).length === changelogTargetLangs().length) {
					await settleJobs();
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.fail("overlays never appeared");
		}

		it("creating a published entry enqueues a translate job (non-blocking)", async () => {
			const res = await api("POST", "/api/admin/changelog", adminHeaders, {
				content: "Auto entry",
				details: "Auto details",
			});
			assert.strictEqual(res.status, 201, JSON.stringify(res.data));
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { _id } = res.data as { _id: string };
			// The POST answers before translations exist — the job is fire-and-forget.
			await waitForOverlays(new ObjectId(_id));
			const doc = await colls.changelogs.findOne({ _id: new ObjectId(_id) });
			assert.strictEqual(doc?.translations?.de?.content, "[t:de] Auto entry");
			assert.strictEqual(
				doc?.translations?.de?.translatedFrom?.hash,
				changelogSourceHash(changelogSourceStrings(doc ?? {})),
			);
		});

		it("publishing a draft (PUT) enqueues too; drafts don't; a no-op re-publish enqueues nothing", async () => {
			const create = await api("POST", "/api/admin/changelog", adminHeaders, {
				content: "Draft first",
				published: false,
			});
			assert.strictEqual(create.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { _id } = create.data as { _id: string };
			// Creating a draft translates nothing.
			await new Promise((resolve) => setTimeout(resolve, 300));
			assert.strictEqual((await colls.changelogs.findOne({ _id: new ObjectId(_id) }))?.translations, undefined);
			assert.strictEqual(await colls.settings.countDocuments({ _id: { $regex: "^bulkTranslateJob:" } }), 0);

			const publish = await api("PUT", `/api/admin/changelog/${_id}`, adminHeaders, { published: true });
			assert.strictEqual(publish.status, 200);
			await waitForOverlays(new ObjectId(_id));

			// Fully-translated already: another PUT enqueues no new job (idempotent).
			const jobsBefore = await colls.settings.countDocuments({ _id: { $regex: "^bulkTranslateJob:" } });
			assert.strictEqual(
				(await api("PUT", `/api/admin/changelog/${_id}`, adminHeaders, { published: true })).status,
				200,
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			assert.strictEqual(await colls.settings.countDocuments({ _id: { $regex: "^bulkTranslateJob:" } }), jobsBefore);
		});

		it("editing a published entry's text re-translates the now-outdated overlays", async () => {
			const res = await api("POST", "/api/admin/changelog", adminHeaders, { content: "Before edit" });
			assert.strictEqual(res.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const id = new ObjectId((res.data as { _id: string })._id);
			await waitForOverlays(id);

			const edit = await api("PUT", `/api/admin/changelog/${id.toHexString()}`, adminHeaders, {
				content: "After edit",
			});
			assert.strictEqual(edit.status, 200);
			for (let i = 0; i < 200; i++) {
				const doc = await colls.changelogs.findOne({ _id: id });
				if (doc?.translations?.fr?.content === "[t:fr] After edit") {
					assert.strictEqual(
						doc.translations.fr.translatedFrom?.hash,
						changelogSourceHash(changelogSourceStrings(doc)),
					);
					await settleJobs();
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.fail("the edited entry was never re-translated");
		});
	});
});
