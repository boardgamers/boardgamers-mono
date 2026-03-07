import type { GameDoc } from "@bgs/models";
import type { GameStatus } from "@bgs/models";
import type { Filter, ObjectId } from "mongodb";
import { colls } from "../config/db.ts";

export function findGamesWithPlayer(playerId: ObjectId) {
  return colls.games.find({ "players._id": playerId }).sort({ lastMove: -1 });
}

export function findGamesWithPlayersTurn(playerId: ObjectId) {
  const conditions: Filter<GameDoc> = {
    status: { $in: ["active", "open"] as GameStatus[] },
    "currentPlayers._id": playerId,
  };
  return colls.games.find(conditions).sort({ status: -1, lastMove: -1 });
}

export const gameBasicsProjection = {
  players: 1,
  currentPlayers: 1,
  "options.setup.nbPlayers": 1,
  "options.timing": 1,
  "game.expansions": 1,
  "game.name": 1,
  "game.version": 1,
  status: 1,
  creator: 1,
  "data.round": 1,
  "context.round": 1,
  lastMove: 1,
  createdAt: 1,
} as const;
