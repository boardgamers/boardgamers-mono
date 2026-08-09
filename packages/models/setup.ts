import type { Collection, Db, IndexDescription, IndexDescriptionInfo, IndexDirection } from "mongodb";
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

// ---------------------------------------------------------------------------
// Index reconciliation
//
// Mongo's createIndexes cannot alter an existing index (same name, different
// options → IndexKeySpecsConflict) nor drop undeclared ones — which used to
// crash-loop the API on boot whenever an index's options changed between
// deploys (#191/#193 dropped `code_1` as a one-off). Instead of a bare
// createIndexes loop, each collection's live indexes are reconciled against
// the declared set: same-name-different-shape indexes are dropped and rebuilt,
// droppedIndexes names are removed, and everything else is created if absent.
// Boot-time races between sibling PM2 processes (index builds/drops are not
// instantaneous) are handled by tolerating the conflict/"not found" codes and
// re-reading the index list until it converges — a mismatch never throws the
// process into a restart loop.
// ---------------------------------------------------------------------------

const NAMESPACE_NOT_FOUND = 26; // collection doesn't exist (fresh/test db)
const INDEX_NOT_FOUND = 27; // IndexNotFound — a sibling process already dropped it
const INDEX_KEY_SPECS_CONFLICT = 85; // IndexKeySpecsConflict — same name, different shape exists
const INDEX_OPTIONS_CONFLICT = 86; // IndexOptionsConflict — same name being built with other options

// Option fields that define an index's shape for reconciliation purposes.
// `key` is compared separately since it lives on the description itself.
const INDEX_SHAPE_FIELDS = [
	"unique",
	"sparse",
	"hidden",
	"expireAfterSeconds",
	"partialFilterExpression",
	"collation",
	"wildcardProjection",
	"weights",
	"default_language",
	"language_override",
	"textIndexVersion",
	"2dsphereIndexVersion",
] as const;

export type IndexAction =
	| { type: "create"; collection: string; name: string }
	| {
			type: "rebuild";
			collection: string;
			name: string;
			reason: string;
			oldOptions: Record<string, unknown>;
			newOptions: Record<string, unknown>;
	  }
	| { type: "drop"; collection: string; name: string; declared: boolean };

// The server back-fills omitted collation fields with its defaults, so a
// declared `{ locale: "en" }` must compare equal to the full live document.
const COLLATION_DEFAULTS: Record<string, unknown> = {
	caseLevel: false,
	caseFirst: "off",
	strength: 3,
	numericOrdering: false,
	alternate: "non-ignorable",
	maxVariable: "punct",
	normalization: false,
	backwards: false,
};

function normalizeCollation(collation: unknown): Record<string, unknown> | undefined {
	if (typeof collation !== "object" || collation === null) {
		return undefined;
	}
	return { ...COLLATION_DEFAULTS, ...collation };
}

export function indexShape(spec: IndexDescription | IndexDescriptionInfo): Record<string, unknown> {
	const shape: Record<string, unknown> = {};
	// Both types are plain option bags here; the union just doesn't index cleanly.
	const bag: Record<string, unknown> = { ...spec };
	delete bag.key;
	for (const field of INDEX_SHAPE_FIELDS) {
		if (field === "collation") {
			const collation = normalizeCollation(bag.collation);
			if (collation) {
				shape.collation = collation;
			}
			continue;
		}
		if (bag[field] !== undefined) {
			shape[field] = bag[field];
		}
	}
	return shape;
}

// Declared keys may be Maps; live keys are always plain objects. Sort entries so
// key comparison doesn't depend on declaration order.
function normalizedEntries(key: IndexDescription["key"]): [string, IndexDirection][] {
	const entries: [string, IndexDirection][] = key instanceof Map ? [...key.entries()] : Object.entries(key);
	return entries.toSorted(([a], [b]) => a.localeCompare(b));
}

function normalizedKey(key: IndexDescription["key"]): string {
	const entries = normalizedEntries(key);
	if (entries.some(([, direction]) => direction === "text")) {
		// Text indexes store a rewritten key ({ _fts: "text", _ftsx: 1 }) on the
		// server; compare them by name + weights instead of by stored key.
		return "text";
	}
	return JSON.stringify(Object.fromEntries(entries));
}

// JSON.stringify with sorted object keys, so nested option documents
// (partialFilterExpression, weights, collation) compare order-independently.
function stableStringify(value: unknown): string {
	if (typeof value !== "object" || value === null) {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const bag: Record<string, unknown> = { ...value };
	const entries = Object.entries(bag).toSorted(([a], [b]) => a.localeCompare(b));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// Options the server fills in on text indexes; declared specs rarely spell them
// out, so ignore them when both sides are text indexes.
const TEXT_INDEX_DEFAULTS: Record<string, unknown> = {
	default_language: "english",
	language_override: "language",
};

function sameIndexShape(existing: IndexDescriptionInfo, declared: IndexDescription): boolean {
	if (normalizedKey(existing.key) !== normalizedKey(declared.key)) {
		return false;
	}
	const isText = normalizedKey(existing.key) === "text";
	const oldShape = indexShape(existing);
	const newShape = indexShape(declared);
	for (const field of new Set([...Object.keys(oldShape), ...Object.keys(newShape)])) {
		if (field === "textIndexVersion") {
			continue; // server-version-dependent
		}
		let before = oldShape[field];
		let after = newShape[field];
		if (isText) {
			// A declared { t: "text" } means weight 1, stored as weights: { t: 1 }.
			if (field === "weights") {
				after ??= Object.fromEntries(
					normalizedEntries(declared.key)
						.filter(([, direction]) => direction === "text")
						.map(([fieldName]) => [fieldName, 1]),
				);
			}
			if (field in TEXT_INDEX_DEFAULTS) {
				after ??= TEXT_INDEX_DEFAULTS[field];
			}
		}
		if (stableStringify(before) !== stableStringify(after)) {
			return false;
		}
	}
	return true;
}

function describeShapeDifferences(existing: IndexDescriptionInfo, declared: IndexDescription): string {
	const differences: string[] = [];
	if (normalizedKey(existing.key) !== normalizedKey(declared.key)) {
		differences.push(`key: ${normalizedKey(existing.key)} → ${normalizedKey(declared.key)}`);
	}
	const oldShape = indexShape(existing);
	const newShape = indexShape(declared);
	for (const field of new Set([...Object.keys(oldShape), ...Object.keys(newShape)])) {
		if (field === "textIndexVersion") {
			continue;
		}
		const before = stableStringify(oldShape[field]);
		const after = stableStringify(newShape[field]);
		if (before !== after) {
			differences.push(`${field}: ${before ?? "<unset>"} → ${after ?? "<unset>"}`);
		}
	}
	return differences.join(", ");
}

function errorCode(err: unknown): number | undefined {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caught errors are untyped; the driver sets `code`
	return (err as { code?: number })?.code;
}

async function listIndexes(collection: Collection): Promise<IndexDescriptionInfo[]> {
	try {
		// `indexes()` throws "ns does not exist" on a collection with no indexes yet
		// (fresh/test db) — that just means "no indexes".
		return await collection.indexes();
	} catch (err) {
		if (errorCode(err) === NAMESPACE_NOT_FOUND || errorCode(err) === INDEX_NOT_FOUND) {
			return [];
		}
		throw err;
	}
}

function declaredIndexName(spec: IndexDescription): string {
	return (
		spec.name ??
		// Mongo derives the default name from the key pattern ("user_1"). The driver
		// computes it lazily, so replicate it here for name-based comparisons.
		Object.entries(spec.key)
			.map(([field, direction]) => `${field}_${String(direction)}`)
			.join("_")
	);
}

export async function reconcileIndexes(
	collection: Collection,
	declared: IndexDescription[],
	drops: string[] = [],
	options: { dryRun?: boolean } = {},
): Promise<IndexAction[]> {
	const collectionName = collection.collectionName;
	const actions: IndexAction[] = [];
	const declaredByName = new Map(declared.map((spec) => [declaredIndexName(spec), spec]));

	for (let attempt = 0; attempt < 5; attempt++) {
		const first = attempt === 0;
		const existing = new Map((await listIndexes(collection)).map((index) => [index.name, index]));
		let raced = false;

		// Phase 1 — drops. Declared drops (indexes removed from the code) and
		// rebuilds (same name, different shape) both go away first, so that a key
		// pattern change can't hit IndexKeySpecsConflict at creation.
		for (const name of drops) {
			if (!existing.has(name)) {
				continue;
			}
			if (first) {
				console.warn(`[ensureIndexes] ${collectionName}: dropping declared index "${name}"`);
				actions.push({ type: "drop", collection: collectionName, name, declared: true });
			}
			if (!options.dryRun) {
				try {
					await collection.dropIndex(name);
				} catch (err) {
					// A sibling PM2 process dropped it first — tolerate only that.
					if (errorCode(err) !== INDEX_NOT_FOUND) {
						throw err;
					}
				}
				existing.delete(name);
			}
		}
		for (const [name, spec] of declaredByName) {
			const live = existing.get(name);
			if (!live || sameIndexShape(live, spec)) {
				continue;
			}
			if (first) {
				console.error(
					`[ensureIndexes] ${collectionName}: rebuilding index "${name}" (${describeShapeDifferences(live, spec)})\n` +
						`  old: ${JSON.stringify({ key: live.key, ...indexShape(live) })}\n` +
						`  new: ${JSON.stringify({ key: spec.key, ...indexShape(spec) })}`,
				);
				actions.push({
					type: "rebuild",
					collection: collectionName,
					name,
					reason: describeShapeDifferences(live, spec),
					oldOptions: { key: live.key, ...indexShape(live) },
					newOptions: { key: spec.key, ...indexShape(spec) },
				});
			}
			if (!options.dryRun) {
				try {
					await collection.dropIndex(name);
				} catch (err) {
					if (errorCode(err) !== INDEX_NOT_FOUND) {
						throw err;
					}
				}
				existing.delete(name);
			}
		}

		// Phase 2 — creates. `existing` is up to date unless a sibling interfered;
		// a 85/86 on createIndex means it did, so re-read and start over.
		for (const [name, spec] of declaredByName) {
			const live = existing.get(name);
			if (live) {
				if (!options.dryRun) {
					continue;
				}
				// Dry-run: shape mismatches were already reported as rebuilds above.
				if (sameIndexShape(live, spec)) {
					continue;
				}
			}
			if (first && !actions.some((a) => a.name === name && (a.type === "create" || a.type === "rebuild"))) {
				actions.push({ type: "create", collection: collectionName, name });
			}
			if (options.dryRun) {
				continue;
			}
			try {
				await collection.createIndex(spec.key, spec);
			} catch (err) {
				const code = errorCode(err);
				if (code === INDEX_KEY_SPECS_CONFLICT || code === INDEX_OPTIONS_CONFLICT) {
					raced = true;
					break;
				}
				throw err;
			}
			existing.set(name, { ...spec, key: Object.fromEntries(normalizedEntries(spec.key)), name, v: 2 });
		}

		if (raced) {
			continue;
		}
		if (options.dryRun) {
			return actions;
		}

		// Convergence check: re-read the live indexes; if a concurrent process
		// left a different shape behind, loop again instead of throwing.
		const final = new Map((await listIndexes(collection)).map((index) => [index.name, index]));
		const converged =
			drops.every((name) => !final.has(name)) &&
			[...declaredByName].every(([name, spec]) => {
				const live = final.get(name);
				return live && sameIndexShape(live, spec);
			});
		if (converged) {
			return actions;
		}
	}

	throw new Error(
		`[ensureIndexes] ${collectionName}: indexes did not converge after 5 passes — ` +
			"another process keeps creating conflicting index shapes",
	);
}

const declaredIndexes: [string, IndexDescription[]][] = [
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

// Indexes removed from the code that still exist on deployed databases.
// createIndexes only creates — it never drops — so anything renamed, replaced
// or simply deleted must be listed here (once) to be removed at boot. Dropping
// tolerates "index not found": several PM2 processes run this concurrently.
const droppedIndexes: [string, string[]][] = [
	// jwtrefreshtokens.code was the session credential in plaintext (#164);
	// migration 1.4.0 hashed every row and the `code` field is gone from the
	// schema, so the old `code_1` index (original non-sparse or transitional
	// sparse form) is dead weight.
	[JWT_REFRESH_TOKENS_COLLECTION, ["code_1"]],
];

export async function ensureIndexes(db: Db, options: { dryRun?: boolean } = {}): Promise<IndexAction[]> {
	const actions: IndexAction[] = [];
	const dropsByCollection = new Map(droppedIndexes);
	for (const [name, drops] of droppedIndexes) {
		if (!declaredIndexes.some(([collectionName]) => collectionName === name)) {
			actions.push(...(await reconcileIndexes(db.collection(name), [], drops, options)));
		}
	}
	for (const [name, indexes] of declaredIndexes) {
		actions.push(...(await reconcileIndexes(db.collection(name), indexes, dropsByCollection.get(name) ?? [], options)));
	}
	return actions;
}

// What ensureIndexes WOULD do, without touching the database. Used by the
// index-drift CI guard: run against a database that already has the base
// branch's indexes, it must report no unexpected rebuilds/drops.
export function planIndexChanges(db: Db): Promise<IndexAction[]> {
	return ensureIndexes(db, { dryRun: true });
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
