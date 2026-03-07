import type { Db, IndexDescription } from "mongodb";

// --- API Error ---
export type { ApiErrorDoc, ApiErrorFront } from "./api-error.ts";
export { apiErrorSchema, API_ERRORS_COLLECTION, apiErrorIndexes, apiErrorsCollectionOptions } from "./api-error.ts";

// --- Chat Message ---
export type { ChatMessageDoc, ChatMessageFront } from "./chatmessage.ts";
export { chatMessageSchema, CHAT_MESSAGES_COLLECTION, chatMessageIndexes, chatMessagesCollectionOptions } from "./chatmessage.ts";

// --- Game ---
export type { GameDoc, GameFront, PlayerInfo, PlayerInfoFront, GameStatus, PlayerOrder } from "./game.ts";
export { gameSchema, playerInfoSchema, gameStatusSchema, playerOrderSchema, GAMES_COLLECTION, gameIndexes } from "./game.ts";

// --- Game Info ---
export type { GameInfoDoc, GameInfoFront, ViewerInfo, GameInfoOption } from "./gameinfo.ts";
export { gameInfoSchema, viewerInfoSchema, gameInfoOptionSchema, GAME_INFOS_COLLECTION } from "./gameinfo.ts";

// --- Game Notification ---
export type { GameNotificationDoc, GameNotificationFront, NotificationKind } from "./gamenotification.ts";
export { gameNotificationSchema, notificationKindSchema, GAME_NOTIFICATIONS_COLLECTION, gameNotificationIndexes } from "./gamenotification.ts";

// --- Game Preferences ---
export type { GamePreferencesDoc, GamePreferencesFront } from "./gamepreferences.ts";
export { gamePreferencesSchema, GAME_PREFERENCES_COLLECTION, gamePreferencesIndexes } from "./gamepreferences.ts";

// --- Image ---
export type { ImageDoc } from "./image.ts";
export { imageSchema, IMAGES_COLLECTION, imageIndexes } from "./image.ts";

// --- JWT Refresh Token ---
export type { JwtRefreshTokenDoc } from "./jwtrefreshtoken.ts";
export { jwtRefreshTokenSchema, JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenIndexes } from "./jwtrefreshtoken.ts";

// --- Log ---
export type { LogDoc } from "./log.ts";
export { logSchema, LOGS_COLLECTION, logsCollectionOptions } from "./log.ts";

// --- Page ---
export type { PageDoc, PageFront } from "./page.ts";
export { pageSchema, PAGES_COLLECTION } from "./page.ts";

// --- Room Metadata ---
export type { RoomMetaDataDoc } from "./roommetadata.ts";
export { roomMetaDataSchema, ROOM_METADATA_COLLECTION, roomMetaDataIndexes } from "./roommetadata.ts";

// --- Settings ---
export type { SettingsDoc } from "./settings.ts";
export { settingsSchema, SETTINGS_COLLECTION, SettingsKey } from "./settings.ts";

// --- User ---
export type { UserDoc, UserFront } from "./user.ts";
export { userSchema, USERS_COLLECTION, userIndexes } from "./user.ts";

// --- Helpers ---
export { zObjectId, zDate } from "./helpers.ts";

// --- Backward-compat aliases for frontend migration from @bgs/types ---
export type { UserFront as IUser, UserFront as IAbstractUser } from "./user.ts";
export type { GameFront as IGame, GameFront as IAbstractGame } from "./game.ts";
export type { GameInfoFront as GameInfo } from "./gameinfo.ts";
export type { GamePreferencesFront as GamePreferences } from "./gamepreferences.ts";
export type { GameNotificationFront as GameNotification } from "./gamenotification.ts";
export type { ChatMessageFront as ChatMessage } from "./chatmessage.ts";
export type { ApiErrorFront as ApiError } from "./api-error.ts";
export type { PageFront as Page } from "./page.ts";
export type { NotificationKind as notificationKind } from "./gamenotification.ts";

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
    await db.collection(collection).createIndexes(indexes);
  }
}
