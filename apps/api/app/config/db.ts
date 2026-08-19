import { type Collection, type Db, MongoClient } from "mongodb";
import {
	type AdminTokenDoc,
	ADMIN_TOKENS_COLLECTION,
	type ApiErrorDoc,
	API_ERRORS_COLLECTION,
	type ChangelogDoc,
	CHANGELOGS_COLLECTION,
	type ChatMessageDoc,
	CHAT_MESSAGES_COLLECTION,
	type DeletedUserDoc,
	DELETED_USERS_COLLECTION,
	type GameDoc,
	GAMES_COLLECTION,
	type GameVersionDoc,
	GAME_INFOS_COLLECTION,
	type GameMetadataDoc,
	GAME_METADATAS_COLLECTION,
	type GameLikeDoc,
	GAME_LIKES_COLLECTION,
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
	type OAuthConsentDoc,
	OAUTH_CONSENTS_COLLECTION,
	type OAuthFlowDoc,
	OAUTH_FLOWS_COLLECTION,
	type PageDoc,
	PAGES_COLLECTION,
	type PageHistoryDoc,
	PAGE_HISTORIES_COLLECTION,
	type RoomMetaDataDoc,
	ROOM_METADATA_COLLECTION,
	type SettingsDoc,
	SETTINGS_COLLECTION,
	type UserActionDoc,
	USER_ACTIONS_COLLECTION,
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
	changelogs: Collection<ChangelogDoc>;
	chatMessages: Collection<ChatMessageDoc>;
	deletedUsers: Collection<DeletedUserDoc>;
	games: Collection<GameDoc>;
	gameInfos: Collection<GameVersionDoc>;
	gameMetadatas: Collection<GameMetadataDoc>;
	gameLikes: Collection<GameLikeDoc>;
	gameNotifications: Collection<GameNotificationDoc>;
	gamePreferences: Collection<GamePreferencesDoc>;
	images: Collection<ImageDoc>;
	jwtRefreshTokens: Collection<JwtRefreshTokenDoc>;
	logs: Collection<LogDoc>;
	oauthConsents: Collection<OAuthConsentDoc>;
	oauthFlows: Collection<OAuthFlowDoc>;
	pages: Collection<PageDoc>;
	pageHistories: Collection<PageHistoryDoc>;
	roomMetaData: Collection<RoomMetaDataDoc>;
	settings: Collection<SettingsDoc>;
	userActions: Collection<UserActionDoc>;
	users: Collection<UserDoc>;
};

function initColls(database: Db) {
	// withAutoUpdatedAt wraps the collections whose schema carries `updatedAt`.
	Object.assign(colls, {
		adminTokens: database.collection<AdminTokenDoc>(ADMIN_TOKENS_COLLECTION),
		apiErrors: withAutoUpdatedAt(database.collection<ApiErrorDoc>(API_ERRORS_COLLECTION)),
		changelogs: withAutoUpdatedAt(database.collection<ChangelogDoc>(CHANGELOGS_COLLECTION)),
		chatMessages: database.collection<ChatMessageDoc>(CHAT_MESSAGES_COLLECTION),
		deletedUsers: database.collection<DeletedUserDoc>(DELETED_USERS_COLLECTION),
		games: withAutoUpdatedAt(database.collection<GameDoc>(GAMES_COLLECTION)),
		gameInfos: withAutoUpdatedAt(database.collection<GameVersionDoc>(GAME_INFOS_COLLECTION)),
		gameMetadatas: withAutoUpdatedAt(database.collection<GameMetadataDoc>(GAME_METADATAS_COLLECTION)),
		gameLikes: withAutoUpdatedAt(database.collection<GameLikeDoc>(GAME_LIKES_COLLECTION)),
		gameNotifications: withAutoUpdatedAt(database.collection<GameNotificationDoc>(GAME_NOTIFICATIONS_COLLECTION)),
		gamePreferences: withAutoUpdatedAt(database.collection<GamePreferencesDoc>(GAME_PREFERENCES_COLLECTION)),
		images: withAutoUpdatedAt(database.collection<ImageDoc>(IMAGES_COLLECTION)),
		jwtRefreshTokens: withAutoUpdatedAt(database.collection<JwtRefreshTokenDoc>(JWT_REFRESH_TOKENS_COLLECTION)),
		logs: database.collection<LogDoc>(LOGS_COLLECTION),
		oauthConsents: database.collection<OAuthConsentDoc>(OAUTH_CONSENTS_COLLECTION),
		oauthFlows: database.collection<OAuthFlowDoc>(OAUTH_FLOWS_COLLECTION),
		pages: withAutoUpdatedAt(database.collection<PageDoc>(PAGES_COLLECTION)),
		pageHistories: database.collection<PageHistoryDoc>(PAGE_HISTORIES_COLLECTION),
		roomMetaData: database.collection<RoomMetaDataDoc>(ROOM_METADATA_COLLECTION),
		settings: withAutoUpdatedAt(database.collection<SettingsDoc>(SETTINGS_COLLECTION)),
		userActions: database.collection<UserActionDoc>(USER_ACTIONS_COLLECTION),
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
	await closeNodebbDb();
}

// --- NodeBB (forum) read-only connection -------------------------------------
// Reusable integration point for reading forum data (deeper forum integration is
// planned). Today only the dead-user cleanup uses it, to detect forum *content*
// (posts). Read-only by convention: nothing in the api should ever write here.
// Lazily connected on first use (never created if unused) and gracefully `null`
// whenever the forum db is unreachable, so callers can fail safe.

/** NodeBB's `objects` collection holds every entity as a `{ _key: ... }` doc. */
export interface NodebbObject {
	_key: string;
	[field: string]: unknown;
}

let nodebbClient: MongoClient | null = null;
let nodebbPromise: Promise<Db | null> | null = null;

async function connectNodebb(): Promise<Db | null> {
	let c: MongoClient | null = null;
	try {
		// serverSelectionTimeoutMS: an unreachable forum must fail fast (the cleanup
		// fails safe to keeping users), not hang the batch for the 30s default.
		c = new MongoClient(env.database.nodebb, { directConnection: true, serverSelectionTimeoutMS: 3000 });
		await c.connect();
		// The db name comes from the connection-string path (the driver's own parser
		// handles credentials / query strings / SRV), defaulting to "nodebb".
		nodebbClient = c;
		return c.db(c.options.dbName ?? "nodebb");
	} catch (err) {
		console.error("[nodebb] unreachable — forum-data reads will fail safe (null)", err);
		await c?.close().catch(() => {});
		nodebbClient = null;
		return null;
	}
}

/**
 * The NodeBB `Db`, or `null` when unreachable. Lazily connected; a `null` result is
 * sticky for the process so a forum outage doesn't turn into repeated reconnect
 * attempts mid-batch.
 */
export function getNodebbDb(): Promise<Db | null> {
	nodebbPromise ??= connectNodebb();
	return nodebbPromise;
}

/**
 * Typed collection accessors over the NodeBB db, mirroring `colls`. Returns `null`
 * when the forum db is unreachable. Add forum collections here as features need
 * them; only `objects` exists today (NodeBB stores users/posts/sets all in it).
 */
export async function nodebbColls(): Promise<{ objects: Collection<NodebbObject> } | null> {
	const database = await getNodebbDb();
	if (!database) {
		return null;
	}
	return { objects: database.collection<NodebbObject>("objects") };
}

export async function closeNodebbDb() {
	await nodebbClient?.close();
	nodebbClient = null;
	nodebbPromise = null;
}
