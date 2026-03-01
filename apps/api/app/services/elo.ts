import type { AnyBulkWriteOperation, ObjectId } from "mongodb";
import { keyBy } from "@bgs/utils/array";
import type { GameDoc, GamePreferencesDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { eloDiff } from "../engine/elo.ts";

export async function processEloForGame(game: Pick<GameDoc, "_id" | "players" | "game" | "cancelled">) {
  const dropped = game.players.some((pl) => pl.dropped);
  const prefs = keyBy(
    await colls.gamePreferences
      .find(
        { game: game.game.name, user: { $in: game.players.map((pl) => pl._id) } },
        { projection: { user: 1, elo: 1 } }
      )
      .toArray(),
    (pref) => pref.user.toString()
  );

  const scores: {
    _id: ObjectId;
    score: number;
    ranking?: number;
    dropped: boolean;
    elo: number;
    games: number;
    eloDelta?: number;
  }[] = structuredClone(game.players).map(({ elo: _, ...pl }) => ({ ...pl, games: 0, elo: 0 }));

  for (const score of scores) {
    const gamePref = prefs[score._id.toString()];
    if (gamePref?.elo?.value) {
      score.elo = gamePref.elo.value;
      score.games = gamePref.elo.games!;
    }
    if (score.ranking) {
      score.score = -score.ranking;
    }
  }

  if (game.cancelled && !dropped) {
    return;
  }

  const gamePrefOps: AnyBulkWriteOperation<GamePreferencesDoc>[] = [];

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
          filter: { user: score._id, game: game.game.name },
          update: { $inc: { "elo.games": 1, "elo.value": eloDelta } },
          upsert: true,
        },
      });
    } else {
      gamePrefOps.push({
        updateOne: {
          filter: { user: score._id, game: game.game.name },
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
    await colls.gamePreferences.bulkWrite(gamePrefOps);
  }

  const scoreVals = scores.map((score, i) => ({
    [`players.${i}.elo.initial`]: score.elo,
    [`players.${i}.elo.delta`]: score.eloDelta,
  }));

  await colls.games.updateOne(
    { _id: game._id },
    { $set: scoreVals.reduce((acc, scoreVal) => ({ ...acc, ...scoreVal }), {}) }
  );
}
