import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

function serverErrorDoc(requestId?: string) {
	return {
		error: { name: "AssertionError", message: "boom", stack: ["AssertionError: boom", "    at handler"] },
		request: { url: "/api/games", method: "POST", body: "{}", status: 422, id: requestId },
		meta: { source: "api-node" },
		createdAt: new Date(),
	};
}

function clientErrorDoc() {
	return {
		error: { name: "TypeError", message: "undefined is not an object", stack: [] },
		request: { url: "https://boardgamers.space/game/123", method: "CLIENT", body: "" },
		meta: { source: "web-client", userAgent: "Mozilla/5.0" },
		createdAt: new Date(),
	};
}

describe("Admin errors listing", () => {
	let adminHeaders: Record<string, string>;

	before(async () => {
		const adminId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		const tokenDoc = { user: adminId, codeHash: hashRefreshCode(generateRefreshCode()), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], true);
		adminHeaders = { Authorization: `Bearer ${token}` };

		await colls.apiErrors.insertMany([
			serverErrorDoc("123e4567-e89b-42d3-a456-426614174000"),
			serverErrorDoc(),
			clientErrorDoc(),
		]);
	});

	after(async () => {
		await db().dropDatabase();
	});

	async function listErrors(params?: Record<string, string>) {
		const search = params ? `?${new URLSearchParams(params)}` : "";
		const res = await fetch(`${baseURL()}/api/admin/errors${search}`, { headers: adminHeaders });
		assert.equal(res.status, 200);
		return res.json() as Promise<{ errors: { meta?: { source?: string } }[]; total: number }>;
	}

	it("lists all errors by default", async () => {
		const { errors, total } = await listErrors();
		assert.equal(total, 3);
		assert.equal(errors.length, 3);
	});

	it("source=client returns only client-reported errors", async () => {
		const { errors, total } = await listErrors({ source: "client" });
		assert.equal(total, 1);
		assert.equal(errors[0].meta?.source, "web-client");
	});

	it("source=server returns only server errors", async () => {
		const { errors, total } = await listErrors({ source: "server" });
		assert.equal(total, 2);
		assert.ok(errors.every((e) => e.meta?.source !== "web-client"));
	});

	it("rejects an invalid source with 400", async () => {
		const res = await fetch(`${baseURL()}/api/admin/errors?source=bogus`, { headers: adminHeaders });
		assert.equal(res.status, 400);
	});
});
