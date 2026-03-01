import type { Db, IndexDescription } from "mongodb";

export type { ApiErrorDoc } from "./api-error.ts";
export { API_ERRORS_COLLECTION, apiErrorIndexes, apiErrorsCollectionOptions } from "./api-error.ts";

export type { ChatMessageDoc } from "./chatmessage.ts";
export { CHAT_MESSAGES_COLLECTION, chatMessageIndexes, chatMessagesCollectionOptions } from "./chatmessage.ts";

export type { GameDoc } from "./game.ts";
export { GAMES_COLLECTION, gameIndexes } from "./game.ts";

export type { GameInfoDoc } from "./gameinfo.ts";
export { GAME_INFOS_COLLECTION } from "./gameinfo.ts";

export type { GameNotificationDoc } from "./gamenotification.ts";
export { GAME_NOTIFICATIONS_COLLECTION, gameNotificationIndexes } from "./gamenotification.ts";

export type { GamePreferencesDoc } from "./gamepreferences.ts";
export { GAME_PREFERENCES_COLLECTION, gamePreferencesIndexes } from "./gamepreferences.ts";

export type { ImageDoc } from "./image.ts";
export { IMAGES_COLLECTION, imageIndexes } from "./image.ts";

export type { JwtRefreshTokenDoc } from "./jwtrefreshtoken.ts";
export { JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenIndexes } from "./jwtrefreshtoken.ts";

export type { LogDoc } from "./log.ts";
export { LOGS_COLLECTION, logsCollectionOptions } from "./log.ts";

export type { PageDoc } from "./page.ts";
export { PAGES_COLLECTION } from "./page.ts";

export type { RoomMetaDataDoc } from "./roommetadata.ts";
export { ROOM_METADATA_COLLECTION, roomMetaDataIndexes } from "./roommetadata.ts";

export type { SettingsDoc } from "./settings.ts";
export { SETTINGS_COLLECTION, SettingsKey } from "./settings.ts";

export type { UserDoc } from "./user.ts";
export { USERS_COLLECTION, userIndexes } from "./user.ts";

// --- Setup helpers ---

import { API_ERRORS_COLLECTION, apiErrorIndexes, apiErrorsCollectionOptions } from "./api-error.ts";
import { CHAT_MESSAGES_COLLECTION, chatMessageIndexes, chatMessagesCollectionOptions } from "./chatmessage.ts";
import { GAMES_COLLECTION, gameIndexes } from "./game.ts";
import { GAME_NOTIFICATIONS_COLLECTION, gameNotificationIndexes } from "./gamenotification.ts";
import { GAME_PREFERENCES_COLLECTION, gamePreferencesIndexes } from "./gamepreferences.ts";
import { IMAGES_COLLECTION, imageIndexes } from "./image.ts";
import { JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenIndexes } from "./jwtrefreshtoken.ts";
import { LOGS_COLLECTION, logsCollectionOptions } from "./log.ts";
import { ROOM_METADATA_COLLECTION, roomMetaDataIndexes } from "./roommetadata.ts";
import { USERS_COLLECTION, userIndexes } from "./user.ts";

async function ensureCappedCollection(db: Db, name: string, options: { size: number; max?: number }) {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name, { capped: true, ...options });
  }
}

export async function ensureCollections(db: Db) {
  await ensureCappedCollection(db, API_ERRORS_COLLECTION, apiErrorsCollectionOptions);
  await ensureCappedCollection(db, CHAT_MESSAGES_COLLECTION, chatMessagesCollectionOptions);
  await ensureCappedCollection(db, LOGS_COLLECTION, logsCollectionOptions);
}

export async function ensureIndexes(db: Db) {
  const indexMap: [string, IndexDescription[]][] = [
    [GAMES_COLLECTION, gameIndexes],
    [USERS_COLLECTION, userIndexes],
    [API_ERRORS_COLLECTION, apiErrorIndexes],
    [CHAT_MESSAGES_COLLECTION, chatMessageIndexes],
    [GAME_NOTIFICATIONS_COLLECTION, gameNotificationIndexes],
    [GAME_PREFERENCES_COLLECTION, gamePreferencesIndexes],
    [IMAGES_COLLECTION, imageIndexes],
    [JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenIndexes],
    [ROOM_METADATA_COLLECTION, roomMetaDataIndexes],
  ];

  for (const [collection, indexes] of indexMap) {
    for (const index of indexes) {
      const { key, ...options } = index;
      await db.collection(collection).createIndex(key as any, options);
    }
  }
}
