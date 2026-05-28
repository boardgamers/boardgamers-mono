import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

export const migration: Migration = {
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
};
