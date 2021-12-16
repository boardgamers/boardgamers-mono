import { GameInfo, GamePreferences, User } from "app/models";
import { expect } from "chai";
import { sortBy } from "lodash";
import { seed } from "scripts/seed";
import GameInfoService from "./gameinfo";

describe("GameInfoService", () => {
  describe("latestAccessibleGames", () => {
    before(async () => {
      await seed(["GameInfo", "User", "GamePreferences"], true);
    });

    it("should return all public games for undefined user", async () => {
      let games = await GameInfoService.latestAccessibleGames();

      expect(sortBy([...games.entries()], (entry) => entry[0])).to.deep.equal([
        ["container", 1],
        ["gaia-project", 1],
      ]);

      await GameInfo.updateOne({ _id: { game: "container", version: 1 } }, { $set: { "meta.public": false } });

      games = await GameInfoService.latestAccessibleGames();

      expect([...games.entries()]).to.deep.equal([["gaia-project", 1]]);
    });

    it("should return all available games for admin user", async () => {
      const user = await User.findByUsername("admin");

      let games = await GameInfoService.latestAccessibleGames(user._id);

      expect([...games.entries()]).to.deep.equal([["gaia-project", 1]]);

      await GameInfo.updateOne({ _id: { game: "container", version: 1 } }, { $set: { "meta.public": false } });
      await GamePreferences.updateOne({ user: user._id, game: "container" }, { $set: { "access.maxVersion": 1 } });

      games = await GameInfoService.latestAccessibleGames(user._id);

      expect(sortBy([...games.entries()], (entry) => entry[0])).to.deep.equal([
        ["container", 1],
        ["gaia-project", 1],
      ]);
    });
  });
});
