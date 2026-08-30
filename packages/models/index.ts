// --- Admin permissions ---
export type { AdminPermission, AdminGrant } from "./admin.ts";
export {
	ADMIN_PERMISSIONS,
	adminPermissionSchema,
	adminGrantSchema,
	gameAdminGrantSchema,
	gameAdminGrant,
	isGameAdminGrant,
	pageGameSlug,
	grantsIncludeGame,
	grantSatisfies,
	userPermissions,
	canUser,
	canUserManageGame,
	hasAnyAdminAccess,
	userRoles,
} from "./admin.ts";

// --- Admin Log (audit trail) ---
export type { AdminLogDoc, AdminLogFront } from "./adminlog.ts";
export { adminLogSchema, ADMIN_LOGS_COLLECTION, adminLogIndexes, ADMIN_LOG_TTL_SECONDS } from "./adminlog.ts";

// --- Admin Token ---
export type { AdminTokenDoc, AdminTokenFront } from "./admintoken.ts";
export { adminTokenSchema, ADMIN_TOKENS_COLLECTION, adminTokenIndexes } from "./admintoken.ts";

// --- API Error ---
export type { ApiErrorDoc, ApiErrorFront } from "./api-error.ts";
export { apiErrorSchema, API_ERRORS_COLLECTION, apiErrorIndexes, apiErrorsCollectionOptions } from "./api-error.ts";

// --- Changelog ---
export type { ChangelogDoc, ChangelogFront, ChangelogTranslations } from "./changelog.ts";
export { changelogSchema, changelogTranslationsSchema, CHANGELOGS_COLLECTION, changelogIndexes } from "./changelog.ts";

// --- Chat Message ---
export type { ChatMessageDoc, ChatMessageFront } from "./chatmessage.ts";
export {
	chatMessageSchema,
	CHAT_MESSAGES_COLLECTION,
	chatMessageIndexes,
	chatMessagesCollectionOptions,
} from "./chatmessage.ts";

// --- Chat Reaction ---
export type { ChatReactionDoc, ChatReactionAggregate } from "./chatreaction.ts";
export {
	chatReactionSchema,
	chatReactionEmojiSchema,
	CHAT_REACTIONS_COLLECTION,
	chatReactionIndexes,
	CHAT_REACTION_EMOJI,
	CHAT_REACTION_QUICK,
	MAX_CHAT_REACTIONS_PER_MESSAGE,
} from "./chatreaction.ts";

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
export type {
	GameInfoDoc,
	GameInfoFront,
	GameVersionDoc,
	GameMetadataDoc,
	GameMetadataTranslations,
	ViewerInfo,
	GameInfoOption,
	GameMetaStatus,
} from "./gameinfo.ts";
export {
	gameInfoSchema,
	gameVersionSchema,
	gameMetadataSchema,
	gameMetadataTranslationsSchema,
	gameMetaStatusSchema,
	GAME_METADATA_FIELDS,
	viewerInfoSchema,
	gameInfoOptionSchema,
	npmPackageNameSchema,
	engineVersionSchema,
	GAME_INFOS_COLLECTION,
	GAME_METADATAS_COLLECTION,
} from "./gameinfo.ts";

// --- Game Like ---
export type { GameLikeDoc, GameLikeFront } from "./gamelike.ts";
export { gameLikeSchema, GAME_LIKES_COLLECTION, gameLikeIndexes } from "./gamelike.ts";

// --- Feedback Request (site + game-specific requests, #340) ---
export type {
	FeedbackRequestDoc,
	FeedbackRequestFront,
	FeedbackRequestLikeDoc,
	FeedbackRequestLikeFront,
	FeedbackKind,
	FeedbackStatus,
} from "./feedbackrequest.ts";
export {
	feedbackRequestSchema,
	feedbackKindSchema,
	feedbackStatusSchema,
	FEEDBACK_REQUESTS_COLLECTION,
	feedbackRequestIndexes,
	feedbackRequestLikeSchema,
	FEEDBACK_REQUEST_LIKES_COLLECTION,
	feedbackRequestLikeIndexes,
} from "./feedbackrequest.ts";

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

// --- Locale (supported UI languages, #306) ---
export type { Locale } from "./locale.ts";
export { locales, defaultLocale, localeNames, isLocale, regionalLocaleDefaults } from "./locale.ts";

// --- JWT Refresh Token ---
export type { JwtRefreshTokenDoc } from "./jwtrefreshtoken.ts";
export { jwtRefreshTokenSchema, JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenIndexes } from "./jwtrefreshtoken.ts";

// --- OAuth Flow (server-side social-login state + provider authorization codes) ---
export type { OAuthFlowDoc } from "./oauthflow.ts";
export { oauthFlowSchema, OAUTH_FLOWS_COLLECTION, oauthFlowIndexes } from "./oauthflow.ts";

// --- OAuth Consent (recorded user consent for OAuth2/OIDC clients) ---
export type { OAuthConsentDoc, OAuthScope } from "./oauthconsent.ts";
export {
	oauthConsentSchema,
	oauthScopeSchema,
	OAUTH_CONSENTS_COLLECTION,
	oauthConsentIndexes,
} from "./oauthconsent.ts";

// --- Log ---
export type { LogDoc, LogFront } from "./log.ts";
export { logSchema, LOGS_COLLECTION, logsCollectionOptions } from "./log.ts";

// --- Newsletter (queued admin blast, delivered by api-cron) ---
export type { NewsletterDoc, NewsletterFront, NewsletterStatus } from "./newsletter.ts";
export { newsletterSchema, newsletterStatusSchema, NEWSLETTERS_COLLECTION, newsletterIndexes } from "./newsletter.ts";

// --- Page ---
export type { PageDoc, PageFront } from "./page.ts";
export { pageSchema, PAGES_COLLECTION } from "./page.ts";

// --- Page History ---
export type { PageHistoryDoc, PageHistoryFront } from "./pagehistory.ts";
export {
	pageHistorySchema,
	PAGE_HISTORIES_COLLECTION,
	pageHistoryIndexes,
	MAX_PAGE_HISTORY_VERSIONS,
} from "./pagehistory.ts";

// --- Room Metadata ---
export type { RoomMetaDataDoc } from "./roommetadata.ts";
export { roomMetaDataSchema, ROOM_METADATA_COLLECTION, roomMetaDataIndexes } from "./roommetadata.ts";

// --- Settings ---
export type { SettingsDoc, Announcement } from "./settings.ts";
export { settingsSchema, SETTINGS_COLLECTION, SettingsKey, announcementSchema } from "./settings.ts";

// --- User ---
export type { UserDoc, UserFront } from "./user.ts";
export { userSchema, USERS_COLLECTION, userIndexes } from "./user.ts";

// --- User Action (per-user action rate-limit counters) ---
export type { UserActionDoc } from "./useraction.ts";
export { userActionSchema, USER_ACTIONS_COLLECTION, userActionIndexes } from "./useraction.ts";

// --- Deleted User (soft-delete archive) ---
export type { DeletedUserDoc } from "./deleteduser.ts";
export { deletedUserSchema, DELETED_USERS_COLLECTION, deletedUserIndexes } from "./deleteduser.ts";

// --- Helpers ---
export { zObjectId, zDate } from "./helpers.ts";
export { zodToMongoSchema } from "./mongo-schema.ts";
export { withAutoUpdatedAt } from "./auto-updated-at.ts";

// --- Backend DB setup (import from "./setup.ts" to avoid pulling mongodb into frontend bundles) ---
export type { IndexAction } from "./setup.ts";
export { ensureCollections, ensureIndexes, ensureValidation, planIndexChanges, reconcileIndexes } from "./setup.ts";
