import type { GameInfo } from "@bgs/types";
import { collections } from "../config/db";

export namespace GameInfoUtils {
  export async function findWithVersion(game: string, version: number | "latest"): Promise<GameInfo | null> {
    if (version === "latest") {
      return await collections.gameInfos.findOne({ "_id.game": game }, { sort: { "_id.version": -1 } });
    }

    return await collections.gameInfos.findOne({
      _id: {
        game,
        version,
      },
    });
  }
}
