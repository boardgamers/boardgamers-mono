import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const notificationKindSchema = z.enum([
  "gameEnded",
  "currentMove",
  "gameStarted",
  "playerDrop",
  "playerQuit",
  "dropPlayer",
]);

export type NotificationKind = z.output<typeof notificationKindSchema>;

export const gameNotificationSchema = z.object({
  _id: zObjectId().optional(),
  game: z.string(),
  user: zObjectId().optional(),
  kind: notificationKindSchema,
  processed: z.boolean(),
  meta: z.record(z.string(), z.unknown()).optional(),
  createdAt: zDate().optional(),
  updatedAt: zDate().optional(),
});

export type GameNotificationDoc = z.output<typeof gameNotificationSchema>;
export type GameNotificationFront = Jsonify<GameNotificationDoc>;

export const GAME_NOTIFICATIONS_COLLECTION = "gamenotifications";

export const gameNotificationIndexes: IndexDescription[] = [
  // api: cron processing of notifications by kind; game-server: same
  { key: { processed: 1, kind: 1 } },
  // api: auto-cleanup after 30 days
  { key: { updatedAt: 1 }, expireAfterSeconds: 86400 * 30 },
];
