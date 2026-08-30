// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { metadataSourceHash, metadataSourceStrings } from "../../models/gameinfo-i18n.ts";
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

interface OverviewJob {
	jobId: string;
	status: "running" | "done" | "error";
	kind?: "pages" | "metadata";
	total: number;
	done: number;
	translated: number;
	skipped: number;
	errors: { page: string; lang: string; message: string }[];
	current?: { page: string; lang: string };
	createdAt?: string;
	updatedAt?: string;
	finishedAt?: string;
}

interface Overview {
	locales: string[];
	metaLangs: string[];
	pages: { name: string; title: string; cells: Record<string, { status: "ok" | "outdated" | "missing" }> }[];
	games: {
		game: string;
		label: string;
		sourceFields: string[];
		cells: Record<string, { status: "ok" | "outdated" | "missing" | "unknown"; fields: string[] }>;
	}[];
	jobs: OverviewJob[];
}

// The fixture user ids live at describe scope: the metadata bulk suite below
// reuses them, re-inserting the docs (its own before() runs after this
// suite's dropDatabase).
const adminId = new ObjectId();
const userId = new ObjectId();
const pagesAdminId = new ObjectId();
const scopedAdminId = new ObjectId();

async function insertFixtureUsers() {
	await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
	await colls.users.insertOne(testUser({ _id: userId }));
	await colls.users.insertOne(testUser({ _id: pagesAdminId, adminGrants: ["pages"] }));
	await colls.users.insertOne(testUser({ _id: scopedAdminId, adminGrants: ["gameinfo:ovgame"] }));
}

describe("Admin translations overview + bulk job lifecycle (#306)", () => {
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	// Fake LLM server: `llmHangOn` never answers requests whose text carries
	// the marker (simulating a hung provider call).
	let llm: http.Server;
	let llmHangOn: string | undefined;

	before(async () => {
		await Promise.all([
			colls.pages.deleteMany({}),
			colls.pageHistories.deleteMany({}),
			colls.gameMetadatas.deleteMany({}),
			colls.settings.deleteMany({ _id: { $regex: "^bulkTranslateJob:" } }),
		]);
		await insertFixtureUsers();
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
		// The suite starts several bulk jobs; relax the per-admin hourly caps.
		ACTION_RATE_LIMITS["admin/translate-bulk"] = { max: 100, windowMs: 60 * 60 * 1000 };
		ACTION_RATE_LIMITS["admin/translate-metadata-bulk"] = { max: 100, windowMs: 60 * 60 * 1000 };

		llmHangOn = undefined;
		llm = http.createServer((req, res) => {
			let raw = "";
			req.on("data", (chunk) => (raw += chunk));
			req.on("end", () => {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse is any; fields are defaulted below
				const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
				const user = body.messages.find((m) => m.role === "user")?.content ?? "";
				if (llmHangOn && user.includes(llmHangOn)) {
					return; // never respond: the pair timeout must fire
				}
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						choices: [{ message: { content: `[t] ${user.split("\n\n").at(-1)}` }, finish_reason: "stop" }],
					}),
				);
			});
		});
		await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
		env.translation.apiKey = "test-key";
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen(0, "127.0.0.1") binds a TCP port, so the address is an AddressInfo
		env.translation.baseUrl = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
		// Keep the per-request LLM timeout short: the hung-pair test below would
		// otherwise wait the full 3-min default before the fetch aborts.
		env.translation.timeoutMs = 2000;
	});

	after(async () => {
		env.translation.apiKey = "";
		env.translation.baseUrl = "https://openrouter.ai/api/v1";
		env.translation.timeoutMs = 180_000;
		await new Promise((resolve) => llm.close(resolve));
		await db().dropDatabase();
	});

	it("requires page access", async () => {
		assert.strictEqual((await api("GET", "/api/admin/translations/overview")).status, 403);
		assert.strictEqual((await api("GET", "/api/admin/translations/overview", userHeaders)).status, 403);
		assert.strictEqual((await api("GET", "/api/admin/page/translate-bulk", userHeaders)).status, 403);
	});

	it("reports ok / outdated / missing per page × locale", async () => {
		await api("PUT", "/api/admin/page/ov-ok/en", adminHeaders, { title: "Ok page", content: "v1" });
		await api("PUT", "/api/admin/page/ov-outdated/en", adminHeaders, { title: "Outdated page", content: "v1" });
		// ov-ok/de up to date, ov-outdated/de stamped against the pre-edit source.
		const okSource = await colls.pages.findOne({ _id: { name: "ov-ok", lang: "en" } });
		await colls.pages.insertOne({
			_id: { name: "ov-ok", lang: "de" },
			title: "Ok de",
			content: "ok",
			translatedFrom: { lang: "en", updatedAt: okSource?.updatedAt ?? new Date() },
		});
		await colls.pages.insertOne({
			_id: { name: "ov-outdated", lang: "de" },
			title: "Outdated de",
			content: "stale",
			translatedFrom: { lang: "en", updatedAt: new Date(Date.now() - 60_000) },
		});
		// ov-missing has no de version at all.
		await api("PUT", "/api/admin/page/ov-missing/en", adminHeaders, { title: "Missing page", content: "v1" });

		const res = await api("GET", "/api/admin/translations/overview", adminHeaders);
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const overview = res.data as Overview;
		const row = (name: string) => overview.pages.find((p) => p.name === name);

		assert.equal(row("ov-ok")?.title, "Ok page");
		assert.equal(row("ov-ok")?.cells.de.status, "ok");
		assert.equal(row("ov-ok")?.cells.en.status, "ok");
		assert.equal(row("ov-outdated")?.cells.de.status, "outdated");
		assert.equal(row("ov-missing")?.cells.de.status, "missing");
		assert.equal(row("ov-missing")?.cells.en.status, "ok");
		// The matrix covers every supported locale.
		for (const lang of overview.locales) {
			assert.ok(row("ov-ok")?.cells[lang], `cell for ${lang}`);
		}
	});

	it("reports game-metadata translation status with the overlay's fields", async () => {
		// Legacy overlays (no translatedFrom stamp — everything written before
		// outdated-tracking existed) report "unknown".
		await colls.gameMetadatas.insertOne({
			_id: "ovgame",
			label: "OV Game",
			players: [2],
			description: "A game",
			translations: { de: { description: "Ein Spiel" }, fr: { description: "Un jeu", rules: "Règles" } },
		});
		await colls.gameMetadatas.insertOne({ _id: "ovbare", label: "OV Bare", players: [2] });

		const res = await api("GET", "/api/admin/translations/overview", adminHeaders);
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const overview = res.data as Overview;
		const game = overview.games.find((g) => g.game === "ovgame");
		assert.ok(game);
		assert.deepEqual(game.sourceFields, ["description"]);
		assert.deepEqual(game.cells.de, { status: "unknown", fields: ["description"] });
		assert.deepEqual(game.cells.fr, { status: "unknown", fields: ["description", "rules"] });
		assert.equal(game.cells.ru.status, "missing");
		const bare = overview.games.find((g) => g.game === "ovbare");
		assert.ok(bare);
		assert.equal(bare.cells.de.status, "missing");
	});

	it("reports ok / outdated for stamped metadata overlays, flipping on a source edit", async () => {
		const sourceHash = metadataSourceHash(metadataSourceStrings({ description: "A game" }));
		await colls.gameMetadatas.insertOne({
			_id: "ovstamp",
			label: "OV Stamped",
			players: [2],
			description: "A game",
			translations: {
				// Translated against the current source text → ok.
				de: { description: "Ein Spiel", translatedFrom: { hash: sourceHash } },
				// Translated against different (older) source text → outdated.
				fr: { description: "Un jeu", translatedFrom: { hash: "0000000000000000" } },
			},
		});

		const res = await api("GET", "/api/admin/translations/overview", adminHeaders);
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const overview = res.data as Overview;
		const game = overview.games.find((g) => g.game === "ovstamp");
		assert.ok(game);
		assert.equal(game.cells.de.status, "ok");
		assert.equal(game.cells.fr.status, "outdated");
		assert.equal(game.cells.ru.status, "missing");

		// A source text edit changes the source hash → the previously-fresh de
		// overlay flips to outdated.
		await colls.gameMetadatas.updateOne({ _id: "ovstamp" }, { $set: { description: "An edited game" } });
		const resAfter = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const flipped = (resAfter.data as Overview).games.find((g) => g.game === "ovstamp");
		assert.equal(flipped?.cells.de.status, "outdated");
		assert.equal(flipped?.cells.fr.status, "outdated");
	});

	it("end-to-end: translate → ok; likes don't flip it; a source edit does; a revert restores ok", async () => {
		// Realistic fixture: a doc that already has an updatedAt and likes —
		// regression guard for the two #415 review blockers (self-invalidation
		// via the overlay write's own updatedAt bump; like-bumps reading as
		// outdated).
		await colls.gameInfos.insertOne({
			_id: { game: "ove2e", version: 1 },
			viewer: { url: "//v1" },
			public: true,
			meta: {},
		});
		await colls.gameMetadatas.insertOne({
			_id: "ove2e",
			label: "OV E2E",
			players: [2],
			description: "The original description.",
			likeCount: 3,
			createdAt: new Date(Date.now() - 86_400_000),
			updatedAt: new Date(Date.now() - 3600_000),
		});

		const statusOf = async () => {
			const res = await api("GET", "/api/admin/translations/overview", adminHeaders);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			return (res.data as Overview).games.find((g) => g.game === "ove2e")?.cells.de.status;
		};

		// The real translate endpoint (against the suite's LLM stub) stamps the
		// overlay; the write itself bumps updatedAt (withAutoUpdatedAt), which
		// must NOT read as outdated.
		const translate = await api("POST", "/api/admin/gameinfo/ove2e/meta/translate", adminHeaders, {
			targetLang: "de",
		});
		assert.strictEqual(translate.status, 200, JSON.stringify(translate.data));
		assert.equal(await statusOf(), "ok");

		// A like bumps updatedAt through the same wrapper the gamelike service
		// uses — the translation is still fresh.
		await colls.gameMetadatas.updateOne({ _id: "ove2e" }, { $inc: { likeCount: 1 } });
		assert.equal(await statusOf(), "ok");

		// A real source edit through the metadata form flips it.
		const edit = await api("PUT", "/api/admin/gameinfo/ove2e/meta", adminHeaders, {
			description: "The edited description.",
		});
		assert.strictEqual(edit.status, 200);
		assert.equal(await statusOf(), "outdated");

		// Edit-then-revert: the content hash matches the stamp again → ok.
		await api("PUT", "/api/admin/gameinfo/ove2e/meta", adminHeaders, {
			description: "The original description.",
		});
		assert.equal(await statusOf(), "ok");
	});

	it("lists every bulk job, newest first, with lifecycle timestamps", async () => {
		await api("PUT", "/api/admin/page/ov-job/en", adminHeaders, { title: "Job page", content: "v1" });

		const res = await api("POST", "/api/admin/page/translate-bulk", adminHeaders, { targetLang: "da" });
		assert.strictEqual(res.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId } = res.data as { jobId: string };

		let job: OverviewJob | undefined;
		for (let i = 0; i < 200; i++) {
			const poll = await api("GET", `/api/admin/page/translate-bulk/${jobId}`, adminHeaders);
			assert.strictEqual(poll.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			job = poll.data as OverviewJob;
			if (job.status !== "running") {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.ok(job, "job found");
		assert.equal(job.status, "done");
		assert.ok(job.createdAt && job.updatedAt && job.finishedAt, "lifecycle timestamps are set");
		assert.equal(job.current, undefined, "no pair in flight once done");

		// The aggregate listing carries the job too.
		const overview = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const listed = (overview.data as Overview).jobs.find((j) => j.jobId === jobId);
		assert.ok(listed, "the job shows up in the overview listing");
		assert.equal(listed.status, "done");
	});

	it("a hung pair times out as an error entry and the job completes", { timeout: 10 * 60_000 }, async () => {
		await api("PUT", "/api/admin/page/ov-hang/en", adminHeaders, { title: "Hang", content: "hang marker page" });
		await api("PUT", "/api/admin/page/ov-fine/en", adminHeaders, { title: "Fine", content: "fine page" });
		llmHangOn = "hang marker";
		try {
			const res = await api("POST", "/api/admin/page/translate-bulk", adminHeaders, { targetLang: "ro" });
			assert.strictEqual(res.status, 202);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { jobId } = res.data as { jobId: string };

			let job: OverviewJob | undefined;
			for (let i = 0; i < 1200; i++) {
				const poll = await api("GET", `/api/admin/page/translate-bulk/${jobId}`, adminHeaders);
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
				job = poll.data as OverviewJob;
				if (job.status !== "running") {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			assert.ok(job, "job found");
			assert.equal(job.status, "done", "the job completes despite the hung pair");
			const hangError = job.errors.find((e) => e.page === "ov-hang");
			assert.ok(hangError, "the hung pair is an error entry");
			assert.match(hangError.message, /timed out|aborted due to timeout/);
			assert.ok(
				job.errors.every((e) => e.page !== "ov-fine"),
				"the other pair was not affected",
			);
			assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "ov-hang", lang: "ro" } }), 0);
			assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "ov-fine", lang: "ro" } }), 1);
		} finally {
			llmHangOn = undefined;
		}
	});

	it("marks a stale running job as interrupted instead of leaving it stuck", async () => {
		await colls.settings.insertOne({
			_id: "bulkTranslateJob:stale-job",
			value: {
				status: "running",
				total: 22,
				done: 1,
				translated: 1,
				skipped: 0,
				errors: [],
				current: { page: "about", lang: "de" },
				createdAt: new Date(Date.now() - 3600_000),
				updatedAt: new Date(Date.now() - 30 * 60_000),
			},
		});

		const res = await api("GET", "/api/admin/page/translate-bulk/stale-job", adminHeaders);
		assert.strictEqual(res.status, 200, JSON.stringify(res.data));
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const job = res.data as OverviewJob;
		assert.equal(job.status, "error");
		assert.ok(
			job.errors.some((e) => e.message.includes("interrupted")),
			"the interruption is explained in the errors",
		);
		assert.ok(job.finishedAt);

		// A recently-updated running job is NOT touched.
		await colls.settings.insertOne({
			_id: "bulkTranslateJob:fresh-job",
			value: {
				status: "running",
				total: 5,
				done: 2,
				translated: 2,
				skipped: 0,
				errors: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		const fresh = await api("GET", "/api/admin/page/translate-bulk/fresh-job", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.equal((fresh.data as OverviewJob).status, "running");
	});

	it("lazily reaps terminal jobs older than 24h on read/list", async () => {
		await colls.settings.insertOne({
			_id: "bulkTranslateJob:old-job",
			value: {
				status: "done",
				total: 3,
				done: 3,
				translated: 3,
				skipped: 0,
				errors: [],
				createdAt: new Date(Date.now() - 48 * 3600_000),
				updatedAt: new Date(Date.now() - 48 * 3600_000),
				finishedAt: new Date(Date.now() - 48 * 3600_000),
			},
		});

		const overview = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.ok(!(overview.data as Overview).jobs.some((j) => j.jobId === "old-job"), "reaped from the listing");
		assert.strictEqual(
			await colls.settings.countDocuments({ _id: "bulkTranslateJob:old-job" }),
			0,
			"the doc is deleted",
		);
		assert.strictEqual((await api("GET", "/api/admin/page/translate-bulk/old-job", adminHeaders)).status, 404);
	});
});

describe("Admin bulk metadata translation (#306 follow-up)", () => {
	let adminHeaders: Record<string, string>;
	let pagesAdminHeaders: Record<string, string>;
	let scopedAdminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	// Fake LLM server, same pattern as the pages bulk suite above: answers
	// every completion with a `[t] ` marker prefix.
	let llm: http.Server;

	// Poll the shared jobs listing until the job turns terminal.
	async function waitForJob(jobId: string): Promise<OverviewJob> {
		for (let i = 0; i < 200; i++) {
			const poll = await api("GET", `/api/admin/page/translate-bulk/${jobId}`, adminHeaders);
			assert.strictEqual(poll.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const job = poll.data as OverviewJob;
			if (job.status !== "running") {
				return job;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.fail(`job ${jobId} still running after 10s`);
	}

	before(async () => {
		await Promise.all([
			colls.gameMetadatas.deleteMany({}),
			colls.settings.deleteMany({ _id: { $regex: "^bulkTranslateJob:" } }),
		]);
		// The previous suite's after() dropped the whole db — re-insert the
		// fixture users before minting tokens for them.
		await insertFixtureUsers();
		adminHeaders = await makeAuthHeaders(adminId);
		pagesAdminHeaders = await makeAuthHeaders(pagesAdminId);
		scopedAdminHeaders = await makeAuthHeaders(scopedAdminId);
		userHeaders = await makeAuthHeaders(userId);

		await colls.gameMetadatas.insertOne({
			_id: "ovgame",
			label: "OV Game",
			players: [2],
			description: "A game",
			rules: "Some rules",
			translations: { de: { description: "Ein Spiel" } },
		});
		await colls.gameMetadatas.insertOne({ _id: "ovbare", label: "OV Bare", players: [2] });
		await colls.gameMetadatas.insertOne({ _id: "ovfull", label: "OV Full", players: [2], description: "Full" });

		llm = http.createServer((req, res) => {
			let raw = "";
			req.on("data", (chunk) => (raw += chunk));
			req.on("end", () => {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse is any; fields are defaulted below
				const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
				const user = body.messages.find((m) => m.role === "user")?.content ?? "";
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						choices: [{ message: { content: `[t] ${user.split("\n\n").at(-1)}` }, finish_reason: "stop" }],
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

	it("is gated to admins, and the run itself to site 'pages' admins", async () => {
		// Mount gate: no grant at all → 403 before the route's own check.
		assert.strictEqual(
			(await api("POST", "/api/admin/translations/translate-metadata-bulk", userHeaders, {})).status,
			403,
		);
		// Route gate: a per-game (gameinfo:<slug>) grant passes the mount gate
		// but an all-games run needs the blanket "pages" permission.
		assert.strictEqual(
			(await api("POST", "/api/admin/translations/translate-metadata-bulk", scopedAdminHeaders, {})).status,
			403,
		);
		// Site "pages" admins (and full admins) can start a run.
		const res = await api("POST", "/api/admin/translations/translate-metadata-bulk", pagesAdminHeaders, {
			targetLang: "el",
		});
		assert.strictEqual(res.status, 202, JSON.stringify(res.data));
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId, total } = res.data as { jobId: string; total: number };
		// Only games with source text AND no el overlay: ovgame + ovfull.
		assert.strictEqual(total, 2);
		const job = await waitForJob(jobId);
		assert.equal(job.status, "done");
		assert.equal(job.translated, 2);
	});

	it("creates a job counting only missing pairs, then translates and stamps overlays", async () => {
		const res = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {
			targetLang: "fr",
		});
		assert.strictEqual(res.status, 202, JSON.stringify(res.data));
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId, total } = res.data as { jobId: string; total: number };
		// ovgame + ovfull have source text and no fr overlay; ovbare has no
		// source fields. (ovgame/el + ovfull/el exist from the previous test.)
		assert.strictEqual(total, 2);

		const job = await waitForJob(jobId);
		assert.equal(job.status, "done");
		assert.equal(job.done, 2);
		assert.equal(job.translated, 2);
		assert.equal(job.skipped, 0);
		assert.deepEqual(job.errors, []);
		assert.equal(job.kind, "metadata");

		// Overlays hold every non-empty source field, translated.
		const ovgame = await colls.gameMetadatas.findOne({ _id: "ovgame" });
		assert.equal(ovgame?.translations?.fr?.description, "[t] A game");
		assert.equal(ovgame?.translations?.fr?.rules, "[t] Some rules");
		assert.equal(ovgame?.translations?.fr?.credits, undefined, "no source credits → no overlay credits");
		// The pre-existing overlay and the source fields are untouched.
		assert.equal(ovgame?.translations?.de?.description, "Ein Spiel");
		assert.equal(ovgame?.description, "A game");
		const ovfull = await colls.gameMetadatas.findOne({ _id: "ovfull" });
		assert.equal(ovfull?.translations?.fr?.description, "[t] Full");
		const ovbare = await colls.gameMetadatas.findOne({ _id: "ovbare" });
		assert.equal(ovbare?.translations, undefined, "no source fields → never translated");

		// Bulk-written overlays carry the same translatedFrom.hash stamp as the
		// per-game translate routes — the source hash at translation time.
		assert.ok(ovgame);
		assert.strictEqual(
			ovgame.translations?.fr?.translatedFrom?.hash,
			metadataSourceHash(metadataSourceStrings(ovgame)),
		);
		assert.ok(ovfull);
		assert.strictEqual(
			ovfull.translations?.fr?.translatedFrom?.hash,
			metadataSourceHash(metadataSourceStrings(ovfull)),
		);

		// The job shows in the overview's jobs table, labelled as metadata; the
		// bulk-translated cells read "ok" (stamped fresh), while the untouched
		// pre-existing de overlay stays stamp-less → "unknown".
		const overview = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const overviewData = overview.data as Overview;
		const listed = overviewData.jobs.find((j) => j.jobId === jobId);
		assert.ok(listed, "the metadata job shows up in the overview listing");
		assert.equal(listed.kind, "metadata");
		assert.equal(listed.status, "done");
		const ovgameRow = overviewData.games.find((g) => g.game === "ovgame");
		assert.equal(ovgameRow?.cells.fr.status, "ok");
		assert.equal(ovgameRow?.cells.de.status, "unknown");
		assert.equal(overviewData.games.find((g) => g.game === "ovfull")?.cells.fr.status, "ok");
	});

	it("skips fresh pairs (stamped overlay, source unchanged)", async () => {
		// Every fr overlay is freshly stamped (bulk-written above) and ovgame's
		// stamp-less de overlay is not an fr pair → nothing to do.
		const res = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {
			targetLang: "fr",
		});
		assert.strictEqual(res.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId, total } = res.data as { jobId: string; total: number };
		assert.strictEqual(total, 0);
		const job = await waitForJob(jobId);
		assert.equal(job.status, "done");
		assert.equal(job.translated, 0);

		// An all-languages run covers every pair still needing translation:
		// source text present and the overlay missing OR not stamped with the
		// current source hash — which pulls in ovgame's stamp-less de overlay
		// too (nothing is outdated at this point). Derive the expectation from
		// the db rather than hardcoding the locale count.
		const overviewRes = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const langs = (overviewRes.data as Overview).metaLangs;
		const docs = await colls.gameMetadatas.find({}).toArray();
		const expectedPairs = docs.flatMap((d) => {
			const source = metadataSourceStrings(d);
			if (Object.keys(source).length === 0) {
				return [];
			}
			const hash = metadataSourceHash(source);
			return langs.filter((l) => d.translations?.[l]?.translatedFrom?.hash !== hash).map((l) => `${d._id}/${l}`);
		});
		assert.ok(expectedPairs.includes("ovgame/de"), "the stamp-less legacy overlay counts as needing translation");
		assert.ok(expectedPairs.length > 0, "there are missing pairs to translate");
		const all = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {});
		assert.strictEqual(all.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const allJob = await waitForJob((all.data as { jobId: string }).jobId);
		assert.equal(allJob.status, "done");
		assert.equal(allJob.total, expectedPairs.length);
		assert.equal(allJob.translated, expectedPairs.length);
		assert.equal(allJob.skipped, 0);
		const ovgame = await colls.gameMetadatas.findOne({ _id: "ovgame" });
		// One overlay per target language.
		assert.deepEqual(Object.keys(ovgame?.translations ?? {}).sort(), [...langs].sort());
		// The legacy stamp-less de overlay was re-translated and is now stamped
		// (one-time cost: the next run sees it fresh).
		assert.ok(ovgame);
		assert.equal(ovgame.translations?.de?.description, "[t] A game");
		assert.strictEqual(
			ovgame.translations?.de?.translatedFrom?.hash,
			metadataSourceHash(metadataSourceStrings(ovgame)),
		);
	});

	it("a deleted game mid-run is skipped, not an error", async () => {
		await colls.gameMetadatas.insertOne({ _id: "ovgone", label: "OV Gone", players: [2], description: "Bye" });
		const res = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {
			targetLang: "hi",
		});
		assert.strictEqual(res.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId, total } = res.data as { jobId: string; total: number };
		assert.strictEqual(total, 1);
		// Racy by nature (the loop may read the doc before the delete lands) —
		// the skip path is the in-loop re-check, exercised deterministically by
		// the missing-overlay re-runs above; here just assert the job completes.
		await colls.gameMetadatas.deleteOne({ _id: "ovgone" });
		const job = await waitForJob(jobId);
		assert.equal(job.status, "done");
		assert.equal(job.done, 1);
	});

	it("unknown (stamp-less) overlays are re-translated and come out stamped — a one-time cost", async () => {
		// Recreate a legacy pre-tracking overlay: strip the de stamp that the
		// all-languages run above wrote.
		await colls.gameMetadatas.updateOne({ _id: "ovgame" }, { $unset: { "translations.de.translatedFrom": "" } });
		const pre = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.equal((pre.data as Overview).games.find((g) => g.game === "ovgame")?.cells.de.status, "unknown");

		const res = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {
			targetLang: "de",
		});
		assert.strictEqual(res.status, 202, JSON.stringify(res.data));
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId, total } = res.data as { jobId: string; total: number };
		assert.strictEqual(total, 1, "only ovgame's stamp-less de overlay needs translation");
		const job = await waitForJob(jobId);
		assert.equal(job.status, "done");
		assert.equal(job.translated, 1);
		assert.equal(job.skipped, 0);

		const ovgame = await colls.gameMetadatas.findOne({ _id: "ovgame" });
		assert.ok(ovgame);
		assert.equal(ovgame.translations?.de?.description, "[t] A game");
		assert.strictEqual(
			ovgame.translations?.de?.translatedFrom?.hash,
			metadataSourceHash(metadataSourceStrings(ovgame)),
		);

		// The cell flips unknown → ok, and the re-translation is one-time: the
		// overlay is stamped now, so the next run has nothing to do.
		const post = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.equal((post.data as Overview).games.find((g) => g.game === "ovgame")?.cells.de.status, "ok");
		const again = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {
			targetLang: "de",
		});
		assert.strictEqual(again.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.strictEqual((again.data as { total: number }).total, 0);
	});

	it("re-translates outdated overlays (stale hash) and flips their cells to ok", async () => {
		// A source edit flips every stamped ovfull overlay to outdated.
		await colls.gameMetadatas.updateOne({ _id: "ovfull" }, { $set: { description: "Full v2" } });
		const pre = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.equal((pre.data as Overview).games.find((g) => g.game === "ovfull")?.cells.fr.status, "outdated");

		const res = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {
			targetLang: "fr",
		});
		assert.strictEqual(res.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId, total } = res.data as { jobId: string; total: number };
		assert.strictEqual(total, 1, "ovfull/fr is outdated; ovgame/fr is fresh and not counted");
		const job = await waitForJob(jobId);
		assert.equal(job.status, "done");
		assert.equal(job.translated, 1);
		assert.equal(job.skipped, 0);

		const ovfull = await colls.gameMetadatas.findOne({ _id: "ovfull" });
		assert.equal(ovfull?.translations?.fr?.description, "[t] Full v2");
		const overview = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const overviewData = overview.data as Overview;
		const row = overviewData.games.find((g) => g.game === "ovfull");
		assert.equal(row?.cells.fr.status, "ok");
		assert.equal(row?.cells.de.status, "outdated", "other languages stay outdated until their own run");

		// An all-languages run picks up the remaining outdated pairs — the
		// total counts missing / outdated / stamp-less alike. Derive the
		// expectation from the db with the same rule.
		const docs = await colls.gameMetadatas.find({}).toArray();
		const expected = docs.flatMap((d) => {
			const source = metadataSourceStrings(d);
			if (Object.keys(source).length === 0) {
				return [];
			}
			const hash = metadataSourceHash(source);
			return overviewData.metaLangs.filter((l) => d.translations?.[l]?.translatedFrom?.hash !== hash);
		});
		assert.ok(expected.length > 0, "there are outdated pairs to refresh");
		const all = await api("POST", "/api/admin/translations/translate-metadata-bulk", adminHeaders, {});
		assert.strictEqual(all.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const allJob = await waitForJob((all.data as { jobId: string }).jobId);
		assert.equal(allJob.status, "done");
		assert.equal(allJob.total, expected.length);
		assert.equal(allJob.translated, expected.length);

		// Nothing is outdated any more.
		const final = await api("GET", "/api/admin/translations/overview", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		for (const g of (final.data as Overview).games) {
			for (const [lang, cell] of Object.entries(g.cells)) {
				assert.notEqual(cell.status, "outdated", `${g.game}/${lang} refreshed`);
			}
		}
	});
});
