import type { GamePreferences as IGamePreferences } from "@bgs/types/gamepreferences";
import type { Dictionary } from "lodash";
import { cloneDeep, keyBy, omit } from "lodash";
import type { Types } from "mongoose";
import { eloDiff } from "../engine/elo";
import { Game, GameDocument, GamePreferences } from "../models";

export default class EloService {
  static async processGame(game: GameDocument) {
    const dropped = game.players.some((pl) => pl.dropped);
    const prefs: Dictionary<IGamePreferences> = keyBy(
      await GamePreferences.find(
        { game: game.game.name, user: { $in: game.players.map((pl) => pl._id) } },
        "user elo"
      ).lean(true),
      (pref) => pref.user.toString()
    );

    const scores: {
      _id: Types.ObjectId;
      score: number;
      ranking?: number;
      dropped: boolean;
      elo: number;
      games: number;
      eloDelta?: number;
    }[] = cloneDeep(game.players).map((pl) => ({ ...omit(pl, "elo"), games: 0, elo: 0 }));

    for (const score of scores) {
      const gamePref = prefs[score._id.toString()];
      if (gamePref?.elo?.value) {
        score.elo = gamePref.elo.value;
        score.games = gamePref.elo.games;
      }
      if (score.ranking) {
        score.score = -score.ranking;
      }
    }

    if (game.cancelled && !dropped) {
      return;
    }

    const gamePrefOps = [];

    for (const score of scores) {
      let eloDelta = 0;

      for (const opponent of scores) {
        if (score._id.equals(opponent._id)) {
          continue;
        }
        eloDelta += eloDiff(score, opponent, dropped, scores.length);
      }
      eloDelta = Math.round(eloDelta);

      if (eloDelta > 0) {
        gamePrefOps.push({
          updateOne: {
            filter: {
              user: score._id,
              game: game.game.name,
            },
            update: {
              $inc: { "elo.games": 1, "elo.value": eloDelta },
            },
            upsert: true,
          },
        });
      } else {
        gamePrefOps.push({
          updateOne: {
            filter: {
              user: score._id,
              game: game.game.name,
            },
            update: [
              {
                $set: {
                  "elo.games": { $add: [{ $ifNull: ["$elo.games", 0] }, 1] },
                  "elo.value": {
                    $switch: {
                      branches: [
                        { case: { $not: "$elo.value" }, then: 1 },
                        { case: { $lt: ["$elo.value", 100] }, then: "$elo.value" },
                      ],
                      default: { $max: [{ $add: ["$elo.value", eloDelta] }, 100] },
                    },
                  },
                },
              },
            ],
            upsert: true,
          },
        });
      }
      score.eloDelta = eloDelta;
    }

    if (gamePrefOps.length > 0) {
      await GamePreferences.bulkWrite(gamePrefOps);
    }
    const scoreVals = scores.map((score, i) => ({
      [`players.${i}.elo.initial`]: score.elo,
      [`players.${i}.elo.delta`]: score.eloDelta,
    }));
    await Game.updateOne(
      { _id: game._id },
      {
        // Convert [{a,b}, {c, d}] into {a, b, c, d}
        $set: scoreVals.reduce((acc, scoreVal) => ({ ...acc, ...scoreVal }), {}),
      }
    );
  }
}
