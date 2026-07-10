import type { GameDoc } from "@bgs/models";
import type { Filter } from "mongodb";
import { colls } from "../config/db.ts";
import locks from "../config/locks.ts";
import { getEngine } from "./engines.ts";
import { afterMove } from "./game.ts";

export async function batchReplay(cond: Filter<GameDoc>) {
  let success = 0;
  let total = 0;

  for await (const game of colls.games.find(cond)) {
    try {
      total++;

      const engine = await getEngine(game.game.name, game.game.version);
      if (!engine?.replay) {
        console.log("no replayability for game", game._id);
        continue;
      }

      {
        await using _lock = await locks.lock("game", game._id);

        let gameData = await engine.replay(game.data);

        if (engine.setPlayerMetaData) {
          game.players.forEach((player, i) => {
            gameData = engine.setPlayerMetaData(gameData, i, { name: player.name });
          });
        }

        const toSave = engine.toSave ? engine.toSave(gameData) : gameData;
        if (toSave) {
          success++;
          await afterMove(engine, game, toSave, game.status === "ended");
        } else {
          console.log("no game data to save for game", game._id);
        }
      }
    } catch (err) {
      console.error(err);
      continue;
    }
  }

  return {
    total,
    success,
  };
}
