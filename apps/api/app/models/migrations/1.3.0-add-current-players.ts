import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

export const migration: Migration = {
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
};
