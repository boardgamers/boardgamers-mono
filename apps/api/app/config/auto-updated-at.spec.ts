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

  it("leaves an explicit updatedAt alone", async () => {
    await resetTimestamp();
    const explicit = new Date("2021-06-15");
    await colls.games.updateOne({ _id: gameId }, { $set: { ready: true, updatedAt: explicit } });
    assert.deepEqual(await updatedAt(), explicit);
  });

  it("does not touch unwrapped collections", async () => {
    await colls.settings.updateOne({ _id: "auto-updated-at-test" }, { $set: { value: 1 } }, { upsert: true });
    const doc = await colls.settings.findOne({ _id: "auto-updated-at-test" });
    assert.ok(doc && !("updatedAt" in doc));
  });

  after(() => db().dropDatabase());
});
