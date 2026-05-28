import { SettingsKey } from "@bgs/models";
import semver from "semver";
import pkg from "../../package.json" with { type: "json" };
import { colls } from "../config/db.ts";
import { recalculateKarma } from "./user.ts";

export const migrations = {
  "1.0.0": {
    async up() {
      await colls.games.updateMany({}, [
        {
          $set: {
            players: {
              $slice: [
                [0, 1, 2, 3, 4, 5].map((i) => ({
                  _id: { $arrayElemAt: ["$players", i] },
                  remainingTime: { $arrayElemAt: ["$remainingTime", i] },
                })),
                { $size: "$players" },
              ],
            },
            game: {
              name: "gaia-project",
              version: 1,
              expansions: { $cond: ["$options.spaceShips", ["spaceships"], []] },
              options: {
                advancedRules: "$options.advancedRules",
                balancedGeneration: "$options.balancedGeneration",
              },
            },
            options: {
              timing: {
                timePerGame: "$options.timePerGame",
                timePerMove: "$options.timePerMove",
              },
              meta: {
                unlisted: "$options.unlisted",
              },
              setup: {
                nbPlayers: "$options.nbPlayers",
                seed: "$options.seed",
                randomPlayerOrder: "$options.randomPlayerOrder",
              },
            },
          },
        },
      ]);
    },
  },
  "1.1.0": {
    async up() {
      await colls.games.updateMany({ open: true }, { $set: { status: "open" }, $unset: { open: 1, active: 1 } });
      await colls.games.updateMany({ active: true }, { $set: { status: "active" }, $unset: { open: 1, active: 1 } });
      await colls.games.updateMany({ active: false }, { $set: { status: "ended" }, $unset: { open: 1, active: 1 } });
      await colls.games.updateMany({ status: { $in: ["active", "ended"] } }, [
        {
          $set: {
            players: {
              $slice: [
                [0, 1, 2, 3, 4, 5].map((i) => ({
                  _id: { $let: { vars: { pl: { $arrayElemAt: ["$players", i] } }, in: "$$pl._id" } },
                  remainingTime: {
                    $let: { vars: { pl: { $arrayElemAt: ["$players", i] } }, in: "$$pl.remainingTime" },
                  },
                  score: {
                    $let: { vars: { pl: { $arrayElemAt: ["$data.players", i] } }, in: "$$pl.data.victoryPoints" },
                  },
                  dropped: { $let: { vars: { pl: { $arrayElemAt: ["$data.players", i] } }, in: "$$pl.dropped" } },
                  faction: { $let: { vars: { pl: { $arrayElemAt: ["$data.players", i] } }, in: "$$pl.faction" } },
                  name: { $let: { vars: { pl: { $arrayElemAt: ["$data.players", i] } }, in: "$$pl.name" } },
                })),
                { $size: "$players" },
              ],
            },
          },
        },
      ]);

      const openGames = await colls.games.find({ status: "open" }).toArray();

      for (const game of openGames) {
        for (const player of game.players) {
          const user = await colls.users.findOne({ _id: player._id });
          if (user) {
            player.name = user.account.username;
          }
        }
        await colls.games.replaceOne({ _id: game._id }, game);
      }
    },
  },
  "1.2.0": {
    async up() {
      const usersList = await colls.users.find({}).toArray();
      for (const user of usersList) {
        await recalculateKarma(user);
      }
    },
  },
  "1.3.0": {
    async up() {
      await colls.games.updateMany(
        {
          status: "active",
        },
        [
          {
            $set: {
              currentPlayers: [
                {
                  _id: "$currentPlayer",
                  timerStart: "$lastMove",
                  deadline: "$nextMoveDeadline",
                },
              ],
            },
          },
        ],
      );
    },
  },
  "1.3.1": {
    async up() {
      const usersList = await colls.users.find({}).toArray();
      for (const user of usersList) {
        const slug = user.account.username.trim().toLowerCase().replace(/\s+/g, "-");
        await colls.users.updateOne({ _id: user._id }, { $set: { "security.slug": slug } });
      }
    },
  },
};

export async function migrate() {
  const latestVersion = pkg.version;
  const dbVersionDoc = await colls.settings.findOne({ _id: SettingsKey.DBVersion });

  if (!dbVersionDoc) {
    const latestMigration = Object.keys(migrations).reduce((max, key) => (semver.gt(key, max) ? key : max), "0.1.0");
    const baseline = semver.gt(latestVersion, latestMigration) ? latestVersion : latestMigration;

    console.log("fresh database detected, skipping historical migrations and stamping version", baseline);
    await colls.settings.updateOne({ _id: SettingsKey.DBVersion }, { $set: { value: baseline } }, { upsert: true });
    return;
  }

  let currentVersion = typeof dbVersionDoc.value === "string" ? dbVersionDoc.value : "0.1.0";

  for (const [key, migration] of Object.entries(migrations)) {
    if (semver.gt(key, currentVersion)) {
      console.log("running migration for", key);
      await migration.up();

      await colls.settings.updateOne({ _id: SettingsKey.DBVersion }, { $set: { value: key } }, { upsert: true });
      currentVersion = key;

      console.log("migration done");
    }
  }

  await colls.settings.updateOne({ _id: SettingsKey.DBVersion }, { $set: { value: latestVersion } }, { upsert: true });
}
