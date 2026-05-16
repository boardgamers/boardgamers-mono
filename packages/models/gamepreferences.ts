import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId } from "./helpers.ts";

export const gamePreferencesSchema = z.object({
  _id: zObjectId().optional(),
  user: zObjectId(),
  game: z.string(),
  preferences: z
    .record(z.string(), z.unknown())
    .and(z.object({ alternateUI: z.boolean().optional() }))
    .optional(),
  access: z.object({
    ownership: z.boolean(),
    maxVersion: z.number().optional(),
  }).optional(),
  elo: z
    .object({
      value: z.number(),
      games: z.number(),
    })
    .optional(),
});

export type GamePreferencesDoc = z.output<typeof gamePreferencesSchema>;
export type GamePreferencesFront = Jsonify<GamePreferencesDoc>;

export const GAME_PREFERENCES_COLLECTION = "gamepreferences";

export const gamePreferencesIndexes: IndexDescription[] = [
  // api: unique per-user per-game preferences
  { key: { user: 1, game: 1 }, unique: true },
  // api: elo leaderboard per game
  { key: { game: 1, "elo.value": -1 }, partialFilterExpression: { "elo.value": { $gt: 0 } } },
];
