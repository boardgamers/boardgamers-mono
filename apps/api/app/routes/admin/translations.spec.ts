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
		cells: Record<string, { translated: boolean; fields: string[] }>;
	}[];
	jobs: OverviewJob[];
}

describe("Admin translations overview + bulk job lifecycle (#306)", () => {
	const adminId = new ObjectId();
	const userId = new ObjectId();
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
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
		// The suite starts several bulk jobs; relax the per-admin hourly cap.
		ACTION_RATE_LIMITS["admin/translate-bulk"] = { max: 100, windowMs: 60 * 60 * 1000 };

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
		// otherwise wait the full 60s default before the fetch aborts.
		env.translation.timeoutMs = 2000;
	});

	after(async () => {
		env.translation.apiKey = "";
		env.translation.baseUrl = "https://openrouter.ai/api/v1";
		env.translation.timeoutMs = 60_000;
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

	it("reports game-metadata translation presence with the overlay's fields", async () => {
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
		assert.deepEqual(game.cells.de, { translated: true, fields: ["description"] });
		assert.deepEqual(game.cells.fr, { translated: true, fields: ["description", "rules"] });
		assert.equal(game.cells.ru.translated, false);
		const bare = overview.games.find((g) => g.game === "ovbare");
		assert.ok(bare);
		assert.equal(bare.cells.de.translated, false);
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
