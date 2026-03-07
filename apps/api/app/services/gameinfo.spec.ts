import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { colls } from "../config/db.ts";
import { findByUsername } from "../models/index.ts";
import { seed } from "../../scripts/seed.ts";
import GameInfoService from "./gameinfo.ts";

function sortedEntries(map: Map<string, number>) {
  return [...map.entries()].toSorted((a, b) => a[0].localeCompare(b[0]));
}

describe("GameInfoService", () => {
  describe("latestAccessibleGames", () => {
    before(async () => {
      await seed(["GameInfo", "User", "GamePreferences"], true);
    });

    it("should return all public games for undefined user", async () => {
      let games = await GameInfoService.latestAccessibleGames();

      assert.deepStrictEqual(sortedEntries(games), [
        ["container", 1],
        ["gaia-project", 1],
        ["powergrid", 1],
      ]);

      await colls.gameInfos.updateOne({ _id: { game: "container", version: 1 } }, { $set: { "meta.public": false } });

      games = await GameInfoService.latestAccessibleGames();

      assert.deepStrictEqual(sortedEntries(games), [
        ["gaia-project", 1],
        ["powergrid", 1],
      ]);
    });

    it("should return all available games for admin user", async () => {
      const user = await findByUsername("admin");

      let games = await GameInfoService.latestAccessibleGames(user._id);

      assert.deepStrictEqual(sortedEntries(games), [
        ["gaia-project", 1],
        ["powergrid", 1],
      ]);

      await colls.gameInfos.updateOne({ _id: { game: "container", version: 1 } }, { $set: { "meta.public": false } });
      await colls.gamePreferences.updateOne(
        { user: user._id, game: "container" },
        { $set: { "access.maxVersion": 1 } },
      );

      games = await GameInfoService.latestAccessibleGames(user._id);

      assert.deepStrictEqual(sortedEntries(games), [
        ["container", 1],
        ["gaia-project", 1],
        ["powergrid", 1],
      ]);
    });
  });
});
