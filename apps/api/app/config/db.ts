import { type Collection, type Db, MongoClient } from "mongodb";
import {
	type AdminTokenDoc,
	ADMIN_TOKENS_COLLECTION,
	type ApiErrorDoc,
	API_ERRORS_COLLECTION,
	type ChatMessageDoc,
	CHAT_MESSAGES_COLLECTION,
	type DeletedUserDoc,
	DELETED_USERS_COLLECTION,
	type GameDoc,
	GAMES_COLLECTION,
	type GameInfoDoc,
	GAME_INFOS_COLLECTION,
	type GameNotificationDoc,
	GAME_NOTIFICATIONS_COLLECTION,
	type GamePreferencesDoc,
	GAME_PREFERENCES_COLLECTION,
	type ImageDoc,
	IMAGES_COLLECTION,
	type JwtRefreshTokenDoc,
	JWT_REFRESH_TOKENS_COLLECTION,
	type LogDoc,
	LOGS_COLLECTION,
	type PageDoc,
	PAGES_COLLECTION,
	type RoomMetaDataDoc,
	ROOM_METADATA_COLLECTION,
	type SettingsDoc,
	SETTINGS_COLLECTION,
	type UserDoc,
	USERS_COLLECTION,
	ensureCollections,
	withAutoUpdatedAt,
	ensureIndexes,
	ensureValidation,
} from "@bgs/models";
import locks from "./locks.ts";
import { migrate } from "../models/migrations/index.ts";
import env from "./env.ts";

let client: MongoClient;
let _db: Db;

export function db(): Db {
	return _db;
}

// Populated by `initColls()` once the DB connection is open. Consumers see the
// non-nullable types so they don't have to guard every access; calling any
// collection before `initDb()` resolves is a programmer error.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const colls = {} as {
	adminTokens: Collection<AdminTokenDoc>;
	apiErrors: Collection<ApiErrorDoc>;
	chatMessages: Collection<ChatMessageDoc>;
	deletedUsers: Collection<DeletedUserDoc>;
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

function initColls(database: Db) {
	// withAutoUpdatedAt wraps the collections whose schema carries `updatedAt`.
	Object.assign(colls, {
		adminTokens: database.collection<AdminTokenDoc>(ADMIN_TOKENS_COLLECTION),
		apiErrors: withAutoUpdatedAt(database.collection<ApiErrorDoc>(API_ERRORS_COLLECTION)),
		chatMessages: database.collection<ChatMessageDoc>(CHAT_MESSAGES_COLLECTION),
		deletedUsers: database.collection<DeletedUserDoc>(DELETED_USERS_COLLECTION),
		games: withAutoUpdatedAt(database.collection<GameDoc>(GAMES_COLLECTION)),
		gameInfos: withAutoUpdatedAt(database.collection<GameInfoDoc>(GAME_INFOS_COLLECTION)),
		gameNotifications: withAutoUpdatedAt(database.collection<GameNotificationDoc>(GAME_NOTIFICATIONS_COLLECTION)),
		gamePreferences: withAutoUpdatedAt(database.collection<GamePreferencesDoc>(GAME_PREFERENCES_COLLECTION)),
		images: withAutoUpdatedAt(database.collection<ImageDoc>(IMAGES_COLLECTION)),
		jwtRefreshTokens: withAutoUpdatedAt(database.collection<JwtRefreshTokenDoc>(JWT_REFRESH_TOKENS_COLLECTION)),
		logs: database.collection<LogDoc>(LOGS_COLLECTION),
		pages: withAutoUpdatedAt(database.collection<PageDoc>(PAGES_COLLECTION)),
		roomMetaData: database.collection<RoomMetaDataDoc>(ROOM_METADATA_COLLECTION),
		settings: withAutoUpdatedAt(database.collection<SettingsDoc>(SETTINGS_COLLECTION)),
		users: withAutoUpdatedAt(database.collection<UserDoc>(USERS_COLLECTION)),
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
	await ensureValidation(_db);

	// Migrations + the dev-seed hint are singleton work: only in the cron process
	// (env.cron — always in dev, the api-cron process in prod). The DB lock makes it
	// safe even if two cron processes overlap during a PM2 reload (lock() is
	// non-blocking and returns null when already held).
	if (env.cron && runMigrations) {
		try {
			await using lock = await locks.lock("migration");
			if (lock) {
				await migrate();
			}
		} catch (err) {
			console.error(err);
		}
	}

	if (env.cron && !env.isProduction && (await colls.users.estimatedDocumentCount()) === 0) {
		console.log("\n⚠️  No users found in the database. Run `pnpm seed` to populate it with dev data.\n");
	}

	client.on("error", (err) => {
		console.error("db error", err);
	});
}

export async function closeDb() {
	await client?.close();
}
