import { ObjectId } from "bson";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import mongoose from "mongoose";
import Game from "./game";
import GameNotification from "./gamenotification";
import GamePreferences from "./gamepreferences";
import User, { defaultKarma, maxKarma } from "./user";

chai.use(chaiAsPromised);

describe("GameNotification", () => {
  const userId = new ObjectId();
  const userId2 = new ObjectId();
  const userId3 = new ObjectId();
  const userId4 = new ObjectId();

  describe("processGameEnded", () => {
    describe("karma", () => {
      before(async () => {
        await User.create({ _id: userId, account: { username: "test", email: "test@test.com" } });
        await User.create({ _id: userId2, account: { username: "test2", email: "test2@test.com" } });
        await Game.create({
          _id: "test",
          game: {
            name: "gaia-project",
            version: 0,
          },
          players: [
            { _id: userId, dropped: false },
            { _id: userId2, dropped: true },
          ],
        });
      });
      after(() => mongoose.connection.db.dropDatabase());

      it("should add karma to the active player and no karma to the dropped player", async () => {
        await GameNotification.create({ kind: "gameEnded", game: "test" });
        await GameNotification.processGameEnded();

        const user = await User.findById(userId);
        const user2 = await User.findById(userId2);
        expect(user.account.karma).to.equal(defaultKarma + 1);
        expect(user2.account.karma).to.equal(defaultKarma);
      });

      it("should not go above 100", async () => {
        await GameNotification.create({ kind: "gameEnded", game: "test" });

        await User.updateOne({ _id: userId }, { $set: { "account.karma": maxKarma } });
        await GameNotification.processGameEnded();

        const user = await User.findById(userId);
        expect(user.account.karma).to.equal(maxKarma);
      });
    });

    describe("elo", () => {
      beforeEach(async () => {
        await User.create({ _id: userId, account: { username: "test", email: "test@test.com" } });
        await User.create({ _id: userId2, account: { username: "test2", email: "test2@test.com" } });
        await User.create({ _id: userId3, account: { username: "test3", email: "test3@test.com" } });
        await User.create({ _id: userId4, account: { username: "test4", email: "test4@test.com" } });
        await Game.create({
          _id: "test",
          game: {
            name: "gaia-project",
            version: 0,
          },
          players: [
            { _id: userId, score: 40, dropped: false },
            { _id: userId2, score: 30, dropped: false },
            { _id: userId3, score: 20, dropped: false },
            { _id: userId4, score: 25, dropped: false },
          ],
        });
        await GamePreferences.create({ game: "gaia-project", user: userId, elo: { value: 120, games: 120 } });
        await GamePreferences.create({ game: "gaia-project", user: userId2, elo: { value: 110, games: 110 } });
        await GamePreferences.create({ game: "gaia-project", user: userId3, elo: { value: 105, games: 5 } });
      });
      afterEach(() => mongoose.connection.db.dropDatabase());

      it("should add elo to player and player2, and min elo 100 to player3, set elo 1 to beginner player4 ", async () => {
        await GameNotification.create({ kind: "gameEnded", game: "test" });
        await GameNotification.processGameEnded();

        const userPref = await GamePreferences.findOne({ user: userId, game: "gaia-project" });
        const userPref2 = await GamePreferences.findOne({ user: userId2, game: "gaia-project" });
        const userPref3 = await GamePreferences.findOne({ user: userId3, game: "gaia-project" });
        const userPref4 = await GamePreferences.findOne({ user: userId4, game: "gaia-project" });
        expect(userPref.elo.value).to.equal(136);
        expect(userPref.elo.games).to.equal(121);
        expect(userPref2.elo.value).to.equal(114);
        expect(userPref3.elo.value).to.equal(100);
        expect(userPref4.elo.value).to.equal(1);
        expect(userPref4.elo.games).to.equal(1);
        const game = await Game.findOne({ _id: "test" });
        expect(game.players[0].elo.initial).to.equal(120);
        expect(game.players[0].elo.delta).to.equal(16);
        expect(game.players[2].elo.initial).to.equal(105);
        expect(game.players[2].elo.delta).to.equal(-58);
        expect(game.players[3].elo.initial).to.equal(0);
        expect(game.players[3].elo.delta).to.equal(-1);
      });

      it("should work when ranking is set", async () => {
        await Game.updateOne(
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

        await GameNotification.create({ kind: "gameEnded", game: "test" });
        await GameNotification.processGameEnded();

        const userPref = await GamePreferences.findOne({ user: userId, game: "gaia-project" });
        const userPref2 = await GamePreferences.findOne({ user: userId2, game: "gaia-project" });
        const userPref3 = await GamePreferences.findOne({ user: userId3, game: "gaia-project" });
        const userPref4 = await GamePreferences.findOne({ user: userId4, game: "gaia-project" });
        expect(userPref.elo.value).to.equal(136);
        expect(userPref.elo.games).to.equal(121);
        expect(userPref2.elo.value).to.equal(114);
        expect(userPref3.elo.value).to.equal(100);
        expect(userPref4.elo.value).to.equal(1);
        expect(userPref4.elo.games).to.equal(1);
        const game = await Game.findOne({ _id: "test" });
        expect(game.players[0].elo.initial).to.equal(120);
        expect(game.players[0].elo.delta).to.equal(16);
        expect(game.players[2].elo.initial).to.equal(105);
        expect(game.players[2].elo.delta).to.equal(-58);
        expect(game.players[3].elo.initial).to.equal(0);
        expect(game.players[3].elo.delta).to.equal(-1);
      });

      it("should not cause errors when dealing with a cancelled game", async () => {
        await Game.create({
          _id: "testCancelled",
          game: {
            name: "gaia-project",
            version: 0,
          },
          players: [
            { _id: userId, score: 40, dropped: false },
            { _id: userId2, score: 30, dropped: true },
            { _id: userId3, score: 20, dropped: false },
            { _id: userId4, score: 25, dropped: false },
          ],
        });

        await GameNotification.create({ kind: "gameEnded", game: "testCancelled" });

        await expect(GameNotification.processGameEnded()).to.eventually.be.fulfilled;
      });
    });
  });

  describe("processPlayerDrop", () => {
    before(async () => {
      await User.create({ _id: userId, account: { username: "test", email: "test@test.com" } });
      await User.create({ _id: userId2, account: { username: "test2", email: "test2@test.com" } });
    });

    after(() => mongoose.connection.db.dropDatabase());

    it("should drop 10 karma after dropping out", async () => {
      await GameNotification.create({
        user: userId,
        kind: "playerDrop",
      });

      await GameNotification.processPlayerDrop();

      const user = await User.findById(userId);

      expect(user.account.karma).to.equal(defaultKarma - 10);
      expect(await GameNotification.countDocuments({ processed: false })).to.equal(
        0,
        "Game notifications should be cleaned up"
      );
    });

    it("should drop 30 more karma if dropped 3 times simulatenously", async () => {
      for (let i = 0; i < 3; i++) {
        await GameNotification.create({
          game: "test" + i,
          user: userId,
          kind: "playerDrop",
        });
      }

      await GameNotification.processPlayerDrop();

      const user = await User.findById(userId);

      expect(user.account.karma).to.equal(defaultKarma - 10 - 30);
    });

    it("should handle multiple player drops simulatenously", async () => {
      for (let i = 0; i < 3; i++) {
        await GameNotification.create({
          game: "test" + i,
          user: userId,
          kind: "playerDrop",
        });
      }

      await GameNotification.create({
        game: "test",
        user: userId2,
        kind: "playerDrop",
      });

      await GameNotification.processPlayerDrop();

      const user = await User.findById(userId);
      const user2 = await User.findById(userId2);

      expect(user.account.karma).to.equal(defaultKarma - 10 - 30 - 30);
      expect(user2.account.karma).to.equal(defaultKarma - 10);
    });
  });
});
