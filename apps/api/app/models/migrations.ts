import semver from "semver";
import pkg from "../../package.json";
import { Game } from "./game";
import { Settings, SettingsKey } from "./settings";
import { User } from "./user";

export const migrations = {
  "1.0.0": {
    async up() {
      await Game.updateMany({}, [
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
      await Game.updateMany({ open: true }, { $set: { status: "open" }, $unset: { open: 1, active: 1 } });
      await Game.updateMany({ active: true }, { $set: { status: "active" }, $unset: { open: 1, active: 1 } });
      await Game.updateMany({ active: false }, { $set: { status: "ended" }, $unset: { open: 1, active: 1 } });
      await Game.updateMany({ status: { $in: ["active", "ended"] } }, [
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

      const openGames = await Game.find({ status: "open" });

      for (const game of openGames) {
        for (const player of game.players) {
          player.name = (await User.findById(player._id)).account.username;
        }
        game.markModified("players");
        await game.save();
      }
    },
  },
  "1.2.0": {
    async up() {
      for (const user of await User.find({}, "account")) {
        await user.recalculateKarma();
        await user.save();
      }
    },
  },
  "1.3.0": {
    async up() {
      await Game.updateMany(
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
        ]
      );
    },
  },
  "1.3.1": {
    async up() {
      for (const user of await User.find({}, "account security")) {
        user.security.slug = user.account.username.trim().toLowerCase().replace(/\s+/g, "-");
        await user.save();
      }
    },
  },
};

export async function migrate() {
  const latestVersion = pkg.version;
  let currentVersion = (await Settings.findById(SettingsKey.DBVersion).lean(true))?.value ?? "0.1.0";

  for (const [key, migration] of Object.entries(migrations)) {
    if (semver.gt(key, currentVersion)) {
      console.log("running migration for", key);
      await migration.up();

      await Settings.updateOne({ _id: SettingsKey.DBVersion }, { value: key }, { upsert: true });
      currentVersion = key;

      console.log("migration done");
    }
  }

  await Settings.updateOne({ _id: SettingsKey.DBVersion }, { value: latestVersion }, { upsert: true });
}
