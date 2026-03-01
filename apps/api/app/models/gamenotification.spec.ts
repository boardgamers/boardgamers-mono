import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { db } from "../config/db.ts";
import { colls } from "../config/db.ts";
import { defaultKarma, maxKarma } from "./user.ts";
import { processGameEnded, processPlayerDrop } from "./gamenotification.ts";

describe("GameNotification", () => {
  const userId = new ObjectId();
  const userId2 = new ObjectId();
  const userId3 = new ObjectId();
  const userId4 = new ObjectId();

  describe("processGameEnded", () => {
    describe("karma", () => {
      before(async () => {
        await db().dropDatabase();

        await colls.users.insertOne({
          _id: userId,
          account: { username: "test", email: "test@test.com", karma: defaultKarma },
        } as any);
        await colls.users.insertOne({
          _id: userId2,
          account: { username: "test2", email: "test2@test.com", karma: defaultKarma },
        } as any);
        await colls.games.insertOne({
          _id: "test",
          game: { name: "gaia-project", version: 0 },
          players: [
            { _id: userId, dropped: false },
            { _id: userId2, dropped: true },
          ],
        } as any);
      });
      after(() => db().dropDatabase());

      it("should add karma to the active player and no karma to the dropped player", async () => {
        await colls.gameNotifications.insertOne({ kind: "gameEnded", game: "test", processed: false } as any);
        await processGameEnded();

        const user = await colls.users.findOne({ _id: userId });
        const user2 = await colls.users.findOne({ _id: userId2 });
        assert.strictEqual(user!.account.karma, defaultKarma + 1);
        assert.strictEqual(user2!.account.karma, defaultKarma);
      });

      it("should not go above 100", async () => {
        await colls.gameNotifications.insertOne({ kind: "gameEnded", game: "test", processed: false } as any);
        await colls.users.updateOne({ _id: userId }, { $set: { "account.karma": maxKarma } });
        await processGameEnded();

        const user = await colls.users.findOne({ _id: userId });
        assert.strictEqual(user!.account.karma, maxKarma);
      });
    });

    describe("elo", () => {
      beforeEach(async () => {
        await colls.users.insertOne({
          _id: userId,
          account: { username: "test", email: "test@test.com", karma: defaultKarma },
        } as any);
        await colls.users.insertOne({
          _id: userId2,
          account: { username: "test2", email: "test2@test.com", karma: defaultKarma },
        } as any);
        await colls.users.insertOne({
          _id: userId3,
          account: { username: "test3", email: "test3@test.com", karma: defaultKarma },
        } as any);
        await colls.users.insertOne({
          _id: userId4,
          account: { username: "test4", email: "test4@test.com", karma: defaultKarma },
        } as any);
        await colls.games.insertOne({
          _id: "test",
          game: { name: "gaia-project", version: 0 },
          players: [
            { _id: userId, score: 40, dropped: false },
            { _id: userId2, score: 30, dropped: false },
            { _id: userId3, score: 20, dropped: false },
            { _id: userId4, score: 25, dropped: false },
          ],
        } as any);
        await colls.gamePreferences.insertOne({
          game: "gaia-project",
          user: userId,
          elo: { value: 120, games: 120 },
        } as any);
        await colls.gamePreferences.insertOne({
          game: "gaia-project",
          user: userId2,
          elo: { value: 110, games: 110 },
        } as any);
        await colls.gamePreferences.insertOne({
          game: "gaia-project",
          user: userId3,
          elo: { value: 105, games: 5 },
        } as any);
      });
      afterEach(() => db().dropDatabase());

      it("should add elo to player and player2, and min elo 100 to player3, set elo 1 to beginner player4 ", async () => {
        await colls.gameNotifications.insertOne({ kind: "gameEnded", game: "test", processed: false } as any);
        await processGameEnded();

        const userPref = await colls.gamePreferences.findOne({ user: userId, game: "gaia-project" });
        const userPref2 = await colls.gamePreferences.findOne({ user: userId2, game: "gaia-project" });
        const userPref3 = await colls.gamePreferences.findOne({ user: userId3, game: "gaia-project" });
        const userPref4 = await colls.gamePreferences.findOne({ user: userId4, game: "gaia-project" });
        assert.strictEqual(userPref!.elo!.value, 136);
        assert.strictEqual(userPref!.elo!.games, 121);
        assert.strictEqual(userPref2!.elo!.value, 114);
        assert.strictEqual(userPref3!.elo!.value, 100);
        assert.strictEqual(userPref4!.elo!.value, 1);
        assert.strictEqual(userPref4!.elo!.games, 1);
        const game = await colls.games.findOne({ _id: "test" });
        assert.strictEqual(game!.players[0].elo!.initial, 120);
        assert.strictEqual(game!.players[0].elo!.delta, 16);
        assert.strictEqual(game!.players[2].elo!.initial, 105);
        assert.strictEqual(game!.players[2].elo!.delta, -58);
        assert.strictEqual(game!.players[3].elo!.initial, 0);
        assert.strictEqual(game!.players[3].elo!.delta, -1);
      });

      it("should work when ranking is set", async () => {
        await colls.games.updateOne(
          { _id: "test" },
          {
            $set: {
              "players.0.score": 0,
              "players.0.ranking": 1,
              "players.1.score": 0,
              "players.1.ranking": 2,
              "players.2.score": 0,
              "players.2.ranking": 4,
              "players.3.score": 0,
              "players.3.ranking": 3,
            },
          }
        );

        await colls.gameNotifications.insertOne({ kind: "gameEnded", game: "test", processed: false } as any);
        await processGameEnded();

        const userPref = await colls.gamePreferences.findOne({ user: userId, game: "gaia-project" });
        const userPref2 = await colls.gamePreferences.findOne({ user: userId2, game: "gaia-project" });
        const userPref3 = await colls.gamePreferences.findOne({ user: userId3, game: "gaia-project" });
        const userPref4 = await colls.gamePreferences.findOne({ user: userId4, game: "gaia-project" });
        assert.strictEqual(userPref!.elo!.value, 136);
        assert.strictEqual(userPref!.elo!.games, 121);
        assert.strictEqual(userPref2!.elo!.value, 114);
        assert.strictEqual(userPref3!.elo!.value, 100);
        assert.strictEqual(userPref4!.elo!.value, 1);
        assert.strictEqual(userPref4!.elo!.games, 1);
        const game = await colls.games.findOne({ _id: "test" });
        assert.strictEqual(game!.players[0].elo!.initial, 120);
        assert.strictEqual(game!.players[0].elo!.delta, 16);
        assert.strictEqual(game!.players[2].elo!.initial, 105);
        assert.strictEqual(game!.players[2].elo!.delta, -58);
        assert.strictEqual(game!.players[3].elo!.initial, 0);
        assert.strictEqual(game!.players[3].elo!.delta, -1);
      });

      it("should not cause errors when dealing with a cancelled game", async () => {
        await colls.games.insertOne({
          _id: "testCancelled",
          game: { name: "gaia-project", version: 0 },
          players: [
            { _id: userId, score: 40, dropped: false },
            { _id: userId2, score: 30, dropped: true },
            { _id: userId3, score: 20, dropped: false },
            { _id: userId4, score: 25, dropped: false },
          ],
        } as any);

        await colls.gameNotifications.insertOne({ kind: "gameEnded", game: "testCancelled", processed: false } as any);
        await processGameEnded();
      });
    });
  });

  describe("processPlayerDrop", () => {
    before(async () => {
      await colls.users.insertOne({
        _id: userId,
        account: { username: "test", email: "test@test.com", karma: defaultKarma },
      } as any);
      await colls.users.insertOne({
        _id: userId2,
        account: { username: "test2", email: "test2@test.com", karma: defaultKarma },
      } as any);
    });

    after(() => db().dropDatabase());

    it("should drop 10 karma after dropping out", async () => {
      await colls.gameNotifications.insertOne({ user: userId, kind: "playerDrop", processed: false } as any);
      await processPlayerDrop();

      const user = await colls.users.findOne({ _id: userId });
      assert.strictEqual(user!.account.karma, defaultKarma - 10);
      assert.strictEqual(
        await colls.gameNotifications.countDocuments({ processed: false }),
        0,
        "Game notifications should be cleaned up"
      );
    });

    it("should drop 30 more karma if dropped 3 times simulatenously", async () => {
      for (let i = 0; i < 3; i++) {
        await colls.gameNotifications.insertOne({
          game: "test" + i,
          user: userId,
          kind: "playerDrop",
          processed: false,
        } as any);
      }
      await processPlayerDrop();

      const user = await colls.users.findOne({ _id: userId });
      assert.strictEqual(user!.account.karma, defaultKarma - 10 - 30);
    });

    it("should handle multiple player drops simulatenously", async () => {
      for (let i = 0; i < 3; i++) {
        await colls.gameNotifications.insertOne({
          game: "test" + i,
          user: userId,
          kind: "playerDrop",
          processed: false,
        } as any);
      }
      await colls.gameNotifications.insertOne({
        game: "test",
        user: userId2,
        kind: "playerDrop",
        processed: false,
      } as any);
      await processPlayerDrop();

      const user = await colls.users.findOne({ _id: userId });
      const user2 = await colls.users.findOne({ _id: userId2 });
      assert.strictEqual(user!.account.karma, defaultKarma - 10 - 30 - 30);
      assert.strictEqual(user2!.account.karma, defaultKarma - 10);
    });
  });
});
