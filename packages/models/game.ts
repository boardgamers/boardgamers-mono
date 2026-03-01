import type { IAbstractGame } from "@bgs/types";
import type { IndexDescription, ObjectId } from "mongodb";

export interface GameDoc extends Omit<IAbstractGame<ObjectId>, "updatedAt" | "createdAt"> {
  _id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const GAMES_COLLECTION = "games";

export const gameIndexes: IndexDescription[] = [
  // api: used for sorting active/recent games
  { key: { updatedAt: 1 } },
  // api: game listings by status, sorted by last move; game-server: same
  { key: { status: 1, lastMove: -1 } },
  // api: find games by player; game-server: same
  { key: { "players._id": 1, lastMove: -1 } },
  // api: scheduled start lookup for open games
  {
    key: { status: 1, "options.timing.scheduledStart": 1 },
    partialFilterExpression: { status: "open", "options.timing.scheduledStart": { $exists: true } },
  },
];
