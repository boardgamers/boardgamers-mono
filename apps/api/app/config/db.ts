import cluster from "cluster";
import { type Collection, type Db, MongoClient } from "mongodb";
import {
  type ApiErrorDoc, API_ERRORS_COLLECTION,
  type ChatMessageDoc, CHAT_MESSAGES_COLLECTION,
  type GameDoc, GAMES_COLLECTION,
  type GameInfoDoc, GAME_INFOS_COLLECTION,
  type GameNotificationDoc, GAME_NOTIFICATIONS_COLLECTION,
  type GamePreferencesDoc, GAME_PREFERENCES_COLLECTION,
  type ImageDoc, IMAGES_COLLECTION,
  type JwtRefreshTokenDoc, JWT_REFRESH_TOKENS_COLLECTION,
  type LogDoc, LOGS_COLLECTION,
  type PageDoc, PAGES_COLLECTION,
  type RoomMetaDataDoc, ROOM_METADATA_COLLECTION,
  type SettingsDoc, SETTINGS_COLLECTION,
  type UserDoc, USERS_COLLECTION,
  ensureCollections,
  ensureIndexes,
} from "@bgs/models";
import locks from "./locks.ts";
import { migrate } from "../models/migrations.ts";
import env from "./env.ts";

let client: MongoClient;
let _db: Db;

export function db(): Db {
  return _db;
}

export const colls = {} as {
  apiErrors: Collection<ApiErrorDoc>;
  chatMessages: Collection<ChatMessageDoc>;
  games: Collection<GameDoc>;
  gameInfos: Collection<GameInfoDoc>;
  gameNotifications: Collection<GameNotificationDoc>;
  gamePreferences: Collection<GamePreferencesDoc>;
  images: Collection<ImageDoc>;
  jwtRefreshTokens: Collection<JwtRefreshTokenDoc>;
  logs: Collection<LogDoc>;
  pages: Collection<PageDoc>;
  roomMetaData: Collection<RoomMetaDataDoc>;
  settings: Collection<SettingsDoc>;
  users: Collection<UserDoc>;
};

function initColls(db: Db) {
  Object.assign(colls, {
    apiErrors: db.collection<ApiErrorDoc>(API_ERRORS_COLLECTION),
    chatMessages: db.collection<ChatMessageDoc>(CHAT_MESSAGES_COLLECTION),
    games: db.collection<GameDoc>(GAMES_COLLECTION),
    gameInfos: db.collection<GameInfoDoc>(GAME_INFOS_COLLECTION),
    gameNotifications: db.collection<GameNotificationDoc>(GAME_NOTIFICATIONS_COLLECTION),
    gamePreferences: db.collection<GamePreferencesDoc>(GAME_PREFERENCES_COLLECTION),
    images: db.collection<ImageDoc>(IMAGES_COLLECTION),
    jwtRefreshTokens: db.collection<JwtRefreshTokenDoc>(JWT_REFRESH_TOKENS_COLLECTION),
    logs: db.collection<LogDoc>(LOGS_COLLECTION),
    pages: db.collection<PageDoc>(PAGES_COLLECTION),
    roomMetaData: db.collection<RoomMetaDataDoc>(ROOM_METADATA_COLLECTION),
    settings: db.collection<SettingsDoc>(SETTINGS_COLLECTION),
    users: db.collection<UserDoc>(USERS_COLLECTION),
  });
}

export default async function initDb(url = env.database.bgs.url, runMigrations = true) {
  if (_db) {
    console.log("DB already initialized");
    return;
  }

  client = new MongoClient(url, { directConnection: true });
  await client.connect();
  _db = client.db(env.database.bgs.name);
  console.log("successfully connected to database");

  initColls(_db);
  locks.init(_db.collection("locks"));

  await ensureCollections(_db);
  await ensureIndexes(_db);

  if (cluster.isMaster && runMigrations) {
    try {
      await using _lock = await locks.lock("migration");
      await migrate();
    } catch (err) {
      console.error(err);
    }
  }

  client.on("error", (err) => {
    console.error("db error", err);
  });
}

export async function closeDb() {
  await client?.close();
}
