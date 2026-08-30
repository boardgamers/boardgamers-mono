// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Context } from "koa";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { adminAuditTrail, scrubMeta } from "./audit.ts";

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

interface ListedLog {
	_id: string;
	admin: { _id: string; name: string };
	action: string;
	target?: { kind: string; id: string; label?: string };
	meta?: Record<string, unknown>;
	method: string;
	path: string;
	createdAt: string;
}

interface AuditListBody {
	logs: ListedLog[];
	total: number;
	page: number;
	limit: number;
	actions: string[];
	admins: string[];
}

describe("Admin audit trail", () => {
	const adminId = new ObjectId();
	const scopedAdminId = new ObjectId();
	const targetId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let scopedHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;
	let adminName: string;
	let targetName: string;

	before(async () => {
		const admin = testUser({ _id: adminId, authority: "admin" });
		const scoped = testUser({ _id: scopedAdminId, adminGrants: ["users"] });
		const target = testUser({ _id: targetId });
		adminName = admin.account.username;
		targetName = target.account.username;
		await colls.users.insertMany([admin, scoped, target]);
		adminHeaders = await makeAuthHeaders(adminId);
		scopedHeaders = await makeAuthHeaders(scopedAdminId);
		userHeaders = await makeAuthHeaders(targetId);
	});

	after(() => db().dropDatabase());

	describe("explicit events", () => {
		it("user.setAuthority: records actor, action, target and meta", async () => {
			const res = await api("POST", `/api/admin/users/${targetId.toHexString()}/authority`, adminHeaders, {
				authority: "user",
			});
			assert.strictEqual(res.status, 200);

			const doc = await colls.adminLogs.findOne({ action: "user.setAuthority" });
			assert.ok(doc, "an adminlogs doc was written");
			assert.equal(doc.admin._id.toHexString(), adminId.toHexString());
			assert.equal(doc.admin.name, adminName);
			assert.deepEqual(doc.target, { kind: "user", id: targetId.toHexString(), label: targetName });
			assert.deepEqual(doc.meta, { authority: "user" });
			assert.equal(doc.method, "POST");
			assert.equal(doc.path, `/api/admin/users/${targetId.toHexString()}/authority`);
			assert.ok(doc.createdAt instanceof Date);
		});

		it("user.clearSessions: records the deletion count", async () => {
			const res = await api("DELETE", `/api/admin/users/${targetId.toHexString()}/refresh-tokens`, adminHeaders);
			assert.strictEqual(res.status, 200);

			const doc = await colls.adminLogs.findOne({ action: "user.clearSessions" });
			assert.ok(doc);
			assert.equal(doc.target?.id, targetId.toHexString());
			assert.equal(typeof doc.meta?.deleted, "number");
		});

		it("token.create: never stores the raw token value", async () => {
			const res = await api("POST", "/api/admin/tokens", adminHeaders, { name: "audit probe", ttlDays: 1 });
			assert.strictEqual(res.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { token } = res.data as { token: string };

			const doc = await colls.adminLogs.findOne({ action: "token.create" });
			assert.ok(doc);
			assert.equal(doc.target?.kind, "adminToken");
			assert.equal(doc.target?.label, "audit probe");
			assert.ok(!JSON.stringify(doc).includes(token), "the raw token appears nowhere in the audit doc");
		});

		it("user.loginAs: the event is attributed to the ADMIN, not the impersonated user", async () => {
			// makeAuthHeaders for the target replaced its sessions in before(); the
			// clearSessions test above deleted them — mint a fresh one so login-as
			// can answer. (login-as mints its own session for the target.)
			const res = await api("POST", "/api/admin/login-as", adminHeaders, { username: targetName });
			assert.strictEqual(res.status, 200);

			const doc = await colls.adminLogs.findOne({ action: "user.loginAs" });
			assert.ok(doc);
			assert.equal(doc.admin._id.toHexString(), adminId.toHexString(), "actor is the admin");
			assert.equal(doc.target?.id, targetId.toHexString(), "target is the impersonated user");
		});
	});

	describe("baseline coverage", () => {
		it("GET requests are never logged", async () => {
			const beforeCount = await colls.adminLogs.countDocuments({});
			assert.strictEqual((await api("GET", "/api/admin/users/stats", adminHeaders)).status, 200);
			assert.equal(await colls.adminLogs.countDocuments({}), beforeCount);
		});

		it("failed mutations (403) are not logged", async () => {
			const beforeCount = await colls.adminLogs.countDocuments({});
			const res = await api("POST", `/api/admin/users/${targetId.toHexString()}/authority`, userHeaders, {
				authority: "admin",
			});
			assert.strictEqual(res.status, 403);
			assert.equal(await colls.adminLogs.countDocuments({}), beforeCount);
		});

		it("the fallback catches a mutating route without an explicit auditLog call", async () => {
			// Simulate an unwired route: the handler mutates and answers 200 but
			// never stages ctx.state.audit.
			const admin = await colls.users.findOne({ _id: adminId });
			assert.ok(admin);
			const ctx = {
				method: "POST",
				path: "/api/admin/some/unwired-route",
				status: 200,
				state: { user: admin },
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Koa ctx stub
			} as unknown as Context;
			await adminAuditTrail(ctx, async () => {});

			const doc = await colls.adminLogs.findOne({ action: "POST /some/unwired-route" });
			assert.ok(doc, "a fallback event was written");
			assert.equal(doc.admin._id.toHexString(), adminId.toHexString());
			assert.equal(doc.path, "/api/admin/some/unwired-route");
			assert.equal(doc.target, undefined);
		});
	});

	describe("scrubbing", () => {
		it("redacts secret-looking keys recursively", () => {
			const scrubbed = scrubMeta({
				karma: 75,
				password: "hunter2",
				nested: { apiToken: "abc", list: [{ secretValue: "x" }, "plain"] },
			});
			assert.deepEqual(scrubbed, {
				karma: 75,
				password: "[redacted]",
				nested: { apiToken: "[redacted]", list: [{ secretValue: "[redacted]" }, "plain"] },
			});
		});

		it("redacts bare key/code only as whole key names", () => {
			const scrubbed = scrubMeta({ key: "s3cret", code: "123456", monkeys: 3, encodedAt: "2024" });
			assert.deepEqual(scrubbed, { key: "[redacted]", code: "[redacted]", monkeys: 3, encodedAt: "2024" });
		});
	});

	describe("GET /api/admin/audit-log", () => {
		it("is gated to full admins: scoped grantees and users get 403", async () => {
			assert.strictEqual((await api("GET", "/api/admin/audit-log", scopedHeaders)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/audit-log", userHeaders)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/audit-log")).status, 403);
		});

		it("lists events newest-first with pagination and filter values", async () => {
			const res = await api("GET", "/api/admin/audit-log?limit=2", adminHeaders);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as AuditListBody;
			assert.ok(body.total >= 4);
			assert.equal(body.logs.length, 2);
			assert.equal(body.page, 1);
			const times = body.logs.map((l) => new Date(l.createdAt).getTime());
			assert.ok(times[0] >= times[1], "newest first");
			assert.ok(body.actions.includes("user.setAuthority"));
			assert.ok(body.admins.includes(adminName));
		});

		it("filters by action, admin and target", async () => {
			const byAction = await api("GET", "/api/admin/audit-log?action=user.setAuthority", adminHeaders);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const actionBody = byAction.data as AuditListBody;
			assert.ok(actionBody.total >= 1);
			assert.ok(actionBody.logs.every((l) => l.action === "user.setAuthority"));

			const byTarget = await api("GET", `/api/admin/audit-log?target=${targetId.toHexString()}`, adminHeaders);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const targetBody = byTarget.data as AuditListBody;
			assert.ok(targetBody.total >= 2);
			assert.ok(targetBody.logs.every((l) => l.target?.id === targetId.toHexString()));

			const byAdmin = await api("GET", `/api/admin/audit-log?admin=${adminName}`, adminHeaders);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const adminBody = byAdmin.data as AuditListBody;
			assert.ok(adminBody.logs.every((l) => l.admin.name === adminName));

			const none = await api("GET", "/api/admin/audit-log?admin=nobody-by-this-name", adminHeaders);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.equal((none.data as AuditListBody).total, 0);
		});
	});
});
