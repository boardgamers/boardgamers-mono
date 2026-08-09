import type { Db, IndexDescription } from "mongodb";
import type { ZodType } from "zod";
import { ADMIN_TOKENS_COLLECTION, adminTokenIndexes, adminTokenSchema } from "./admintoken.ts";
import { API_ERRORS_COLLECTION, apiErrorIndexes, apiErrorsCollectionOptions, apiErrorSchema } from "./api-error.ts";
import {
	CHAT_MESSAGES_COLLECTION,
	chatMessageIndexes,
	chatMessagesCollectionOptions,
	chatMessageSchema,
} from "./chatmessage.ts";
import { GAMES_COLLECTION, gameIndexes, gameSchema } from "./game.ts";
import { GAME_INFOS_COLLECTION, gameInfoSchema } from "./gameinfo.ts";
import { GAME_NOTIFICATIONS_COLLECTION, gameNotificationIndexes, gameNotificationSchema } from "./gamenotification.ts";
import { GAME_PREFERENCES_COLLECTION, gamePreferencesIndexes, gamePreferencesSchema } from "./gamepreferences.ts";
import { IMAGES_COLLECTION, imageIndexes, imageSchema } from "./image.ts";
import { JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenIndexes, jwtRefreshTokenSchema } from "./jwtrefreshtoken.ts";
import { LOGS_COLLECTION, logsCollectionOptions, logSchema } from "./log.ts";
import { OAUTH_FLOWS_COLLECTION, oauthFlowIndexes, oauthFlowSchema } from "./oauthflow.ts";
import { PAGES_COLLECTION, pageSchema } from "./page.ts";
import { ROOM_METADATA_COLLECTION, roomMetaDataIndexes, roomMetaDataSchema } from "./roommetadata.ts";
import { SETTINGS_COLLECTION, settingsSchema } from "./settings.ts";
import { USERS_COLLECTION, userIndexes, userSchema } from "./user.ts";
import { DELETED_USERS_COLLECTION, deletedUserIndexes, deletedUserSchema } from "./deleteduser.ts";
import { zodToMongoSchema } from "./mongo-schema.ts";

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
	// jwtrefreshtokens.code was the session credential in plaintext (#164). New docs
	// carry only `codeHash`, and the legacy unique non-sparse `code_1` index rejects
	// the second code-less doc (duplicate null) — but createIndexes can't alter it in
	// place (same name, different options → IndexKeySpecsConflict). Drop it here so
	// createIndexes can rebuild it sparse (legacy docs still carry `code`; the sparse
	// index keeps the legacy plaintext lookup indexed while hash-only docs coexist).
	// Skip when the collection doesn't exist yet (fresh/test db) — dropIndex would
	// throw "ns does not exist".
	const collectionExists = (await db.listCollections({ name: JWT_REFRESH_TOKENS_COLLECTION }).toArray()).length > 0;
	if (collectionExists) {
		try {
			await db.collection(JWT_REFRESH_TOKENS_COLLECTION).dropIndex("code_1");
		} catch (err) {
			// Tolerate only "index not found" (codeName IndexNotFound, code 27): the index
			// is already gone — never existed, or a sibling api/cron process dropped it
			// first (PM2 starts several at once). Any other failure (permissions,
			// transient) leaves the legacy index in place and must fail startup loudly.
			const code = (err as { code?: number })?.code;
			if (code !== 27) {
				throw err;
			}
		}
	}

	const indexMap: [string, IndexDescription[]][] = [
		[ADMIN_TOKENS_COLLECTION, adminTokenIndexes],
		[GAMES_COLLECTION, gameIndexes],
		[USERS_COLLECTION, userIndexes],
		[API_ERRORS_COLLECTION, apiErrorIndexes],
		[CHAT_MESSAGES_COLLECTION, chatMessageIndexes],
		[GAME_NOTIFICATIONS_COLLECTION, gameNotificationIndexes],
		[GAME_PREFERENCES_COLLECTION, gamePreferencesIndexes],
		[IMAGES_COLLECTION, imageIndexes],
		[JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenIndexes],
		[OAUTH_FLOWS_COLLECTION, oauthFlowIndexes],
		[ROOM_METADATA_COLLECTION, roomMetaDataIndexes],
		[DELETED_USERS_COLLECTION, deletedUserIndexes],
	];

	for (const [collection, indexes] of indexMap) {
		await db.collection(collection).createIndexes(indexes);
	}
}

export async function ensureValidation(db: Db) {
	const validationMap: [string, ZodType][] = [
		[ADMIN_TOKENS_COLLECTION, adminTokenSchema],
		[API_ERRORS_COLLECTION, apiErrorSchema],
		[CHAT_MESSAGES_COLLECTION, chatMessageSchema],
		[GAMES_COLLECTION, gameSchema],
		[GAME_INFOS_COLLECTION, gameInfoSchema],
		[GAME_NOTIFICATIONS_COLLECTION, gameNotificationSchema],
		[GAME_PREFERENCES_COLLECTION, gamePreferencesSchema],
		[IMAGES_COLLECTION, imageSchema],
		[JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenSchema],
		[LOGS_COLLECTION, logSchema],
		[OAUTH_FLOWS_COLLECTION, oauthFlowSchema],
		[PAGES_COLLECTION, pageSchema],
		[ROOM_METADATA_COLLECTION, roomMetaDataSchema],
		[SETTINGS_COLLECTION, settingsSchema],
		[USERS_COLLECTION, userSchema],
		[DELETED_USERS_COLLECTION, deletedUserSchema],
	];

	const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

	for (const [collection, schema] of validationMap) {
		if (!existing.has(collection)) {
			continue;
		}
		try {
			const $jsonSchema = zodToMongoSchema(schema);
			await db.command({
				collMod: collection,
				validator: { $jsonSchema },
				validationAction: "warn",
				validationLevel: "moderate",
			});
		} catch (err) {
			console.warn(`Failed to set validation on ${collection}:`, err);
		}
	}
}
