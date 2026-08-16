// Test credentials in the seeded DB (fixtures/User.json) — every user's password is
// literally "password". E.g. log in with admin@test.com / password.
import type { GameDoc, GameInfoDoc, GameMetadataDoc, GameNotificationDoc, UserDoc } from "@bgs/models";
import { GAME_METADATA_FIELDS, gameInfoSchema, gamePreferencesSchema, settingsSchema, userSchema } from "@bgs/models";
import type { ZodType } from "zod";
import { env } from "../app/config/index.ts";
import initDb, { closeDb, db } from "../app/config/db.ts";
import * as fixtures from "./fixtures/index.ts";
import { buildSeedGame } from "./lib/build-seed-game.ts";
import { fetchGameInfos } from "./lib/fetch-gameinfos.ts";

const isTest = process.env.NODE_ENV === "test";

if (process.env.NODE_ENV !== "test") {
	env.script = true;
}

const collectionMap: Record<string, string> = {
	User: "users",
	GameInfo: "gameinfos",
	GamePreferences: "gamepreferences",
	chatMessages: "chatmessages",
	settings: "settings",
	pages: "pages",
};

// Fixtures are plain JSON, so id/date fields arrive as strings. Parsing each
// item through its document schema applies the zObjectId()/zDate() transforms,
// turning them into real ObjectId/Date values before insert — otherwise the API
// (which queries by ObjectId) never matches a string _id. See WORKAROUNDS.md.
const schemaMap: Record<string, ZodType> = {
	User: userSchema,
	GameInfo: gameInfoSchema,
	GamePreferences: gamePreferencesSchema,
	settings: settingsSchema,
};

export type SeedOptions = {
	/** Which collections to seed. Defaults to every collection with a fixture. */
	collections?: string[];
	/** Clear each collection before inserting, so the fixtures fully replace its contents. */
	drop?: boolean;
};

export async function seed({ collections, drop }: SeedOptions = {}) {
	for (const collection of collections ?? Object.keys(fixtures)) {
		const collName = collectionMap[collection];
		if (!collName) {
			console.error(`Collection ${collection} is not mapped`);
			continue;
		}

		const coll = db().collection(collName);

		if (!(collection in fixtures)) {
			console.error(`Collection ${collection} does not have a seeding file`);
			continue;
		}

		let items: Record<string, unknown>[] = (fixtures as Record<string, Record<string, unknown>[]>)[collection];
		// Whether `items` still needs schema parsing. fetchGameInfos already returns
		// parsed GameInfoDocs, so we skip re-parsing those.
		let parsed = false;

		// In dev, seed GameInfo with the latest *public* version of each game,
		// pulled live from a public BGS API. Tests stay deterministic on the
		// committed JSON fixtures, and any fetch failure falls back to them too.
		if (collection === "GameInfo" && !isTest) {
			try {
				items = await fetchGameInfos();
				parsed = true;
				console.log(`Fetched ${items.length} game info(s) from the public API`);
			} catch (err) {
				console.warn("Could not fetch game infos from the public API, falling back to local data:", err);
			}
		}

		// Apply the document schema so id/date strings in the JSON fixtures become
		// real ObjectId/Date values (see schemaMap above).
		const schema = schemaMap[collection];
		if (schema && !parsed) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			items = items.map((item) => schema.parse(item) as Record<string, unknown>);
		}

		if (drop) {
			await coll.deleteMany({});
		}

		// Allow inserting seed announcement, ... even with auto-inserted data regarding migrations
		const insertMissingById = collection === "settings" && !drop;

		if (!drop && !insertMissingById && (await coll.estimatedDocumentCount()) > 0) {
			console.warn(`Collection ${collection} is not empty, skipping`);
			continue;
		}

		if (collection === "GameInfo") {
			// Split each merged GameInfo into a version doc (`gameinfos`) + a per-game
			// metadata doc (`gamemetadatas`) (#298). The merged fixture still carries the
			// game-level fields, so strip them off the version docs and derive the
			// metadata docs from the game's max version (the fixture has one version
			// per game anyway).
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `items` was parsed through gameInfoSchema (or fetchGameInfos), which guarantees the compound `_id`
			await seedGameInfo(items as SeedGameInfoDoc[], drop);
			continue;
		}

		if (insertMissingById) {
			console.log(`Inserting missing item(s) into collection ${collection} (existing docs left untouched)`);
			await Promise.all(
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion
				(items as { _id: object; [key: string]: unknown }[]).map(({ _id, ...rest }) =>
					// `_id` is fixed by the filter; `$setOnInsert` never touches existing docs.
					coll.updateOne({ _id }, Object.keys(rest).length ? { $setOnInsert: rest } : { $setOnInsert: { _id } }, {
						upsert: true,
					}),
				),
			);
		} else {
			console.log(`Inserting ${items.length} item(s) in collection ${collection}`);
			await coll.insertMany(items);
		}
	}

	// Build a startable game from the seeded data. Dev-only: it derives the game
	// from whatever GameInfo was actually seeded (correct version + default
	// options) and emits a `gameStarted` notification so the game-server engine
	// initializes it. Skipped in tests, which assert on a fixed fixture state.
	if (!isTest && (!collections || collections.includes("Game"))) {
		await seedStartableGame(drop);
	}
}

type SeedGameInfoDoc = Record<string, unknown> & { _id: { game: string; version: number } };

function splitGameInfo(info: SeedGameInfoDoc): {
	versionDoc: Record<string, unknown>;
	metadataDoc: Record<string, unknown> & { _id: string };
} {
	const versionDoc: Record<string, unknown> = {};
	const metadataDoc: Record<string, unknown> & { _id: string } = { _id: info._id.game };
	for (const [key, value] of Object.entries(info)) {
		// likeCount is game-scoped but not in GAME_METADATA_FIELDS (the migration/admin
		// route must never move or accept it) — a prod-fetched merged doc still carries
		// it, and it belongs on the metadata doc. `liked` is the per-user flag (#289),
		// meaningless in a seed.
		if ((GAME_METADATA_FIELDS as readonly string[]).includes(key) || key === "likeCount") {
			metadataDoc[key] = value;
		} else if (key !== "liked") {
			versionDoc[key] = value;
		}
	}
	return { versionDoc, metadataDoc };
}

async function seedGameInfo(items: SeedGameInfoDoc[], drop: boolean | undefined) {
	const versions = db().collection("gameinfos");
	const metadatas = db().collection("gamemetadatas");

	if (drop) {
		await versions.deleteMany({});
		await metadatas.deleteMany({});
	} else {
		// Keep parity with the generic path: don't clobber an already-seeded db.
		if ((await versions.estimatedDocumentCount()) > 0 && (await metadatas.estimatedDocumentCount()) > 0) {
			console.warn("Collection GameInfo is not empty, skipping");
			return;
		}
	}

	const versionDocs: Record<string, unknown>[] = [];
	const metadataDocs = new Map<string, Record<string, unknown>>();
	for (const item of items) {
		const { versionDoc, metadataDoc } = splitGameInfo(item);
		versionDocs.push(versionDoc);
		if (!metadataDocs.has(metadataDoc._id)) {
			metadataDocs.set(metadataDoc._id, metadataDoc);
		}
	}
	await versions.insertMany(versionDocs);
	await metadatas.insertMany([...metadataDocs.values()]);
	console.log(`Inserting ${versionDocs.length} game version(s) + ${metadataDocs.size} game metadata doc(s)`);
}

async function seedStartableGame(drop?: boolean) {
	const games = db().collection<GameDoc>("games");

	if (drop) {
		await games.deleteMany({});
	} else if ((await games.estimatedDocumentCount()) > 0) {
		await reemitLostStartNotifications();
		console.warn("Collection games is not empty, skipping startable game");
		return;
	}

	const versionDoc = await db()
		.collection<GameInfoDoc>("gameinfos")
		.findOne({ "_id.game": "gaia-project" }, { sort: { "_id.version": -1 } });

	if (!versionDoc) {
		console.warn("No gaia-project game info seeded; skipping startable game");
		return;
	}

	const metadata = await db().collection<GameMetadataDoc>("gamemetadatas").findOne({ _id: "gaia-project" });
	const { _id: _metadataId, ...metadataFields } = metadata ?? {};
	const gameInfo: GameInfoDoc = { ...versionDoc, ...metadataFields } as GameInfoDoc;

	const users = await db().collection<UserDoc>("users").find({}).limit(4).toArray();

	const { game, notification } = buildSeedGame(gameInfo, users);

	console.log(`Inserting startable ${game.game.name} v${game.game.version} game (${game._id})`);
	await games.insertOne(game);
	await db().collection<GameNotificationDoc>("gamenotifications").insertOne(notification);
}

/**
 * The `gameStarted` notification that starts a seeded game can be lost: the
 * gamenotifications TTL index deletes docs 30 days after `updatedAt`, so if the
 * game-server didn't process it in time (not running, engine install failing),
 * the game stays `open` forever with an empty queue. Re-emit it for any full,
 * open, ready game that has no pending `gameStarted` notification.
 */
async function reemitLostStartNotifications() {
	const games = db().collection<GameDoc>("games");
	const notifications = db().collection<GameNotificationDoc>("gamenotifications");

	const stuck = await games
		.find({ status: "open", ready: true, $expr: { $gte: [{ $size: "$players" }, "$options.setup.nbPlayers"] } })
		.project<{ _id: string }>({ _id: 1 })
		.toArray();

	for (const { _id } of stuck) {
		const pending = await notifications.countDocuments({ game: _id, kind: "gameStarted", processed: false });
		if (pending > 0) {
			continue;
		}
		const now = new Date();
		await notifications.insertOne({ game: _id, kind: "gameStarted", processed: false, createdAt: now, updatedAt: now });
		console.log(`Re-emitted gameStarted notification for stuck game ${_id}`);
	}
}

async function run() {
	const drop = process.argv.includes("--drop");

	if (drop) {
		console.warn("Running with --drop: existing documents in seeded collections will be removed");
	}

	await initDb();
	await seed({ drop });
	await closeDb();
}

if (process.env.NODE_ENV !== "test") {
	void run();
}
