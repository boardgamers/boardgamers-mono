// --- API Error ---
export type { ApiErrorDoc, ApiErrorFront } from "./api-error.ts";
export { apiErrorSchema, API_ERRORS_COLLECTION, apiErrorIndexes, apiErrorsCollectionOptions } from "./api-error.ts";

// --- Chat Message ---
export type { ChatMessageDoc, ChatMessageFront } from "./chatmessage.ts";
export {
  chatMessageSchema,
  CHAT_MESSAGES_COLLECTION,
  chatMessageIndexes,
  chatMessagesCollectionOptions,
} from "./chatmessage.ts";

// --- Game ---
export type { GameDoc, GameFront, PlayerInfo, PlayerInfoFront, GameStatus, PlayerOrder } from "./game.ts";
export {
  gameSchema,
  playerInfoSchema,
  gameStatusSchema,
  playerOrderSchema,
  GAMES_COLLECTION,
  gameIndexes,
} from "./game.ts";

// --- Game Info ---
export type { GameInfoDoc, GameInfoFront, ViewerInfo, GameInfoOption } from "./gameinfo.ts";
export { gameInfoSchema, viewerInfoSchema, gameInfoOptionSchema, GAME_INFOS_COLLECTION } from "./gameinfo.ts";

// --- Game Notification ---
export type { GameNotificationDoc, GameNotificationFront, NotificationKind } from "./gamenotification.ts";
export {
  gameNotificationSchema,
  notificationKindSchema,
  GAME_NOTIFICATIONS_COLLECTION,
  gameNotificationIndexes,
} from "./gamenotification.ts";

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
export type { SettingsDoc, Announcement } from "./settings.ts";
export { settingsSchema, SETTINGS_COLLECTION, SettingsKey, announcementSchema } from "./settings.ts";

// --- User ---
export type { UserDoc, UserFront } from "./user.ts";
export { userSchema, USERS_COLLECTION, userIndexes } from "./user.ts";

// --- Helpers ---
export { zObjectId, zDate } from "./helpers.ts";
export { zodToMongoSchema } from "./mongo-schema.ts";
export { withAutoUpdatedAt } from "./auto-updated-at.ts";

// --- Backend DB setup (import from "./setup.ts" to avoid pulling mongodb into frontend bundles) ---
export { ensureCollections, ensureIndexes, ensureValidation } from "./setup.ts";
