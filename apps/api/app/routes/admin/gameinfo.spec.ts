import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

const baseInfo = {
	label: " 💎 Splendor",
	players: [2, 3, 4],
	viewer: { url: "//example.com/viewer.js" },
	meta: { public: true },
};

describe("Admin gameinfo API — alias (issue #106)", () => {
	let headers: Record<string, string>;

	before(async () => {
		const adminId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		const code = generateRefreshCode();
		const tokenDoc = { user: adminId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], true);
		headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
	});

	after(() => db().dropDatabase());

	async function put(body: Record<string, unknown>) {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/splendor/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify(body),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));
		return colls.gameInfos.findOne({ _id: { game: "splendor", version: 1 } });
	}

	it("sets the alias, serves it on the public endpoints, and clears it on null", async () => {
		let doc = await put({ ...baseInfo, alias: "Gem Trader" });
		assert.strictEqual(doc?.alias, "Gem Trader");

		// The public list + single-doc endpoints expose the alias (web renders it everywhere).
		const listSchema = z.array(z.object({ _id: z.object({ game: z.string() }), alias: z.string().optional() }));
		const list = listSchema.parse(await (await fetch(`${baseURL()}/api/boardgame/info`)).json());
		assert.strictEqual(list.find((g) => g._id.game === "splendor")?.alias, "Gem Trader");
		const single = z
			.object({ alias: z.string().optional() })
			.parse(await (await fetch(`${baseURL()}/api/boardgame/splendor`)).json());
		assert.strictEqual(single.alias, "Gem Trader");

		// null clears the alias (JSON can't carry undefined — GameEdit sends null).
		doc = await put({ ...baseInfo, alias: null });
		assert.strictEqual(doc && "alias" in doc, false, "alias field is removed from the doc");

		// Omitting the field entirely leaves a previously-set alias untouched.
		await put({ ...baseInfo, alias: "Gem Trader" });
		doc = await put(baseInfo);
		assert.strictEqual(doc?.alias, "Gem Trader");
	});
});
