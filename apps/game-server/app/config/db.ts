import { type Collection, type Db, MongoClient } from "mongodb";
import {
  type ApiErrorDoc, API_ERRORS_COLLECTION,
  type ChatMessageDoc, CHAT_MESSAGES_COLLECTION,
  type GameDoc, GAMES_COLLECTION,
  type GameInfoDoc, GAME_INFOS_COLLECTION,
  type GameNotificationDoc, GAME_NOTIFICATIONS_COLLECTION,
  ensureCollections,
  ensureIndexes,
} from "@bgs/models";
import env from "./env.ts";
import locks from "./locks.ts";

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
};

const client = new MongoClient(env.database.bgs.url, { directConnection: true });
await client.connect();
_db = client.db(env.database.bgs.name);
console.log("successfully connected to database");

Object.assign(colls, {
  apiErrors: _db.collection<ApiErrorDoc>(API_ERRORS_COLLECTION),
  chatMessages: _db.collection<ChatMessageDoc>(CHAT_MESSAGES_COLLECTION),
  games: _db.collection<GameDoc>(GAMES_COLLECTION),
  gameInfos: _db.collection<GameInfoDoc>(GAME_INFOS_COLLECTION),
  gameNotifications: _db.collection<GameNotificationDoc>(GAME_NOTIFICATIONS_COLLECTION),
});

locks.init(_db.collection("locks"));

await ensureCollections(_db);
await ensureIndexes(_db);
