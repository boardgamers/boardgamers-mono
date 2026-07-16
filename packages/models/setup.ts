import type { Db, IndexDescription } from "mongodb";
import type { ZodType } from "zod";
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
import { PAGES_COLLECTION, pageSchema } from "./page.ts";
import { ROOM_METADATA_COLLECTION, roomMetaDataIndexes, roomMetaDataSchema } from "./roommetadata.ts";
import { SETTINGS_COLLECTION, settingsSchema } from "./settings.ts";
import { USERS_COLLECTION, userIndexes, userSchema } from "./user.ts";
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

export async function ensureValidation(db: Db) {
  const validationMap: [string, ZodType][] = [
    [API_ERRORS_COLLECTION, apiErrorSchema],
    [CHAT_MESSAGES_COLLECTION, chatMessageSchema],
    [GAMES_COLLECTION, gameSchema],
    [GAME_INFOS_COLLECTION, gameInfoSchema],
    [GAME_NOTIFICATIONS_COLLECTION, gameNotificationSchema],
    [GAME_PREFERENCES_COLLECTION, gamePreferencesSchema],
    [IMAGES_COLLECTION, imageSchema],
    [JWT_REFRESH_TOKENS_COLLECTION, jwtRefreshTokenSchema],
    [LOGS_COLLECTION, logSchema],
    [PAGES_COLLECTION, pageSchema],
    [ROOM_METADATA_COLLECTION, roomMetaDataSchema],
    [SETTINGS_COLLECTION, settingsSchema],
    [USERS_COLLECTION, userSchema],
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
