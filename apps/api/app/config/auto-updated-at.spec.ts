import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "./db.ts";
import { testGame, testPlayer } from "./test-helpers.ts";

describe("withAutoUpdatedAt", () => {
	const gameId = "auto-updated-at-test";
	const old = new Date("2020-01-01");

	before(async () => {
		const player = testPlayer({ _id: new ObjectId() });
		const game = testGame({ _id: gameId, game: { name: "test", version: 1 }, players: [player] });
		game.updatedAt = old;
		// The createdAt tests below assert on a doc that lacks it.
		Reflect.deleteProperty(game, "createdAt");
		await colls.games.insertOne(game);
	});

	async function updatedAt(): Promise<Date | undefined> {
		const game = await colls.games.findOne({ _id: gameId }, { projection: { updatedAt: 1 } });
		return game?.updatedAt;
	}

	async function resetTimestamp() {
		// Bypass the wrapper's auto-bump by touching updatedAt explicitly.
		await colls.games.updateOne({ _id: gameId }, { $set: { updatedAt: old } });
		assert.deepEqual(await updatedAt(), old);
	}

	it("bumps updatedAt on updateOne", async () => {
		await resetTimestamp();
		await colls.games.updateOne({ _id: gameId }, { $set: { ready: true } });
		assert.ok((await updatedAt())! > old);
	});

	it("bumps updatedAt on replaceOne", async () => {
		await resetTimestamp();
		const game = (await colls.games.findOne({ _id: gameId }))!;
		await colls.games.replaceOne({ _id: gameId }, game);
		assert.ok((await updatedAt())! > old);
	});

	it("bumps updatedAt on aggregation-pipeline updates", async () => {
		await resetTimestamp();
		await colls.games.updateOne({ _id: gameId }, [{ $set: { ready: false } }]);
		assert.ok((await updatedAt())! > old);
	});

	it("stamps createdAt on upsert-insert but not on a plain update", async () => {
		const id = "auto-updated-at-upsert";
		await colls.games.updateOne({ _id: id }, { $set: { ready: true } }, { upsert: true });
		const inserted = await colls.games.findOne({ _id: id }, { projection: { createdAt: 1, updatedAt: 1 } });
		assert.ok(inserted?.createdAt instanceof Date);
		assert.ok(inserted?.updatedAt instanceof Date);

		await colls.games.updateOne({ _id: gameId }, { $set: { ready: true } });
		const updated = await colls.games.findOne({ _id: gameId }, { projection: { createdAt: 1 } });
		assert.ok(updated && updated.createdAt === undefined);
	});

	it("leaves an explicit createdAt alone", async () => {
		const id = "auto-updated-at-createdat";
		const explicit = new Date("2021-06-15");
		await colls.games.updateOne({ _id: id }, { $set: { ready: true, createdAt: explicit } }, { upsert: true });
		const doc = await colls.games.findOne({ _id: id }, { projection: { createdAt: 1 } });
		assert.deepEqual(doc?.createdAt, explicit);
	});

	it("leaves an explicit updatedAt alone", async () => {
		await resetTimestamp();
		const explicit = new Date("2021-06-15");
		await colls.games.updateOne({ _id: gameId }, { $set: { ready: true, updatedAt: explicit } });
		assert.deepEqual(await updatedAt(), explicit);
	});

	it("does not touch unwrapped collections", async () => {
		await colls.chatMessages.insertOne({
			room: "auto-updated-at-test",
			data: { text: "hello" },
			type: "text",
		});
		const doc = await colls.chatMessages.findOne({ room: "auto-updated-at-test" });
		assert.ok(doc && !("updatedAt" in doc) && !("createdAt" in doc));
	});

	after(() => db().dropDatabase());
});
