import type { Game, GameStatus } from "@bgs/types";
import type { ObjectId, FindCursor, WithId } from "mongodb";
import { collections } from "../config/db";

export namespace GameUtils {
  export async function findWithPlayer(playerId: ObjectId): Promise<FindCursor<WithId<Game<ObjectId>>>> {
    return collections.games.find({ "players._id": playerId }).sort({ lastMove: -1 });
  }

  export async function findWithPlayersTurn(playerId: ObjectId): Promise<FindCursor<WithId<Game<ObjectId>>>> {
    return collections.games
      .find({ status: { $in: ["active", "open"] satisfies GameStatus[] }, "currentPlayers._id": playerId })
      .sort({ status: -1, lastMove: -1 });
  }

  export async function basicProjection(): Promise<string[]> {
    return [
      "players",
      "currentPlayers",
      "options.setup.nbPlayers",
      "options.timing",
      "game.expansions",
      "game.name",
      "game.version",
      "status",
      "creator",
      "data.round",
      "lastMove",
      "createdAt",
    ];
  }
}
