import type { GameNotification } from "@bgs/types";
import type { IndexDescription, ObjectId } from "mongodb";

export interface GameNotificationDoc extends GameNotification<ObjectId> {
  _id?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const GAME_NOTIFICATIONS_COLLECTION = "gamenotifications";

export const gameNotificationIndexes: IndexDescription[] = [
  // api: cron processing of notifications by kind; game-server: same
  { key: { processed: 1, kind: 1 } },
  // api: auto-cleanup after 30 days
  { key: { updatedAt: 1 }, expireAfterSeconds: 86400 * 30 },
];
