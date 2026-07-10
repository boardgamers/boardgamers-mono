import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

export const migration: Migration = {
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
};
