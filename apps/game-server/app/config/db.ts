import { type Db, MongoClient } from "mongodb";
import {
  type ApiErrorDoc,
  API_ERRORS_COLLECTION,
  type ChatMessageDoc,
  CHAT_MESSAGES_COLLECTION,
  type GameDoc,
  GAMES_COLLECTION,
  type GameInfoDoc,
  GAME_INFOS_COLLECTION,
  type GameNotificationDoc,
  GAME_NOTIFICATIONS_COLLECTION,
  ensureCollections,
  withAutoUpdatedAt,
  ensureIndexes,
  ensureValidation,
} from "@bgs/models";
import env from "./env.ts";
import locks from "./locks.ts";

const client = new MongoClient(env.database.bgs.url, { directConnection: true });
const _db = client.db(env.database.bgs.name);
console.log("successfully connected to database");

export function db(): Db {
  return _db;
}

// withAutoUpdatedAt wraps the collections whose schema carries `updatedAt`.
export const colls = {
  apiErrors: withAutoUpdatedAt(_db.collection<ApiErrorDoc>(API_ERRORS_COLLECTION)),
  chatMessages: _db.collection<ChatMessageDoc>(CHAT_MESSAGES_COLLECTION),
  games: withAutoUpdatedAt(_db.collection<GameDoc>(GAMES_COLLECTION)),
  gameInfos: _db.collection<GameInfoDoc>(GAME_INFOS_COLLECTION),
  gameNotifications: withAutoUpdatedAt(_db.collection<GameNotificationDoc>(GAME_NOTIFICATIONS_COLLECTION)),
};

await client.connect();

locks.init(_db.collection("locks"));

await ensureCollections(_db);
await ensureIndexes(_db);
await ensureValidation(_db);
