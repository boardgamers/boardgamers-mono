import type { GamePreferences } from "@bgs/types";
import type { IndexDescription, ObjectId } from "mongodb";

export interface GamePreferencesDoc extends GamePreferences<ObjectId> {}

export const GAME_PREFERENCES_COLLECTION = "gamepreferences";

export const gamePreferencesIndexes: IndexDescription[] = [
  // api: unique per-user per-game preferences
  { key: { user: 1, game: 1 }, unique: true },
  // api: elo leaderboard per game
  { key: { game: 1, "elo.value": -1 }, partialFilterExpression: { "elo.value": { $gt: 0 } } },
];
