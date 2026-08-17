import { engineVersionSchema, gameInfoSchema, GAME_METADATA_FIELDS, npmPackageNameSchema } from "@bgs/models";
import { omit } from "@bgs/utils/object";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { findByEmail, findByUsername, findGameInfoWithVersion } from "../../models/index.ts";
import { lastAccessibleVersion } from "../../services/gameinfo.ts";
import { gameBundleS3Key, publicObjectUrl, putObject, s3Enabled } from "../../services/s3.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
	const versions = await colls.gameInfos
		.find({}, { projection: { _id: 1, "meta.archived": 1 } })
		.sort({ "_id.game": 1, "_id.version": -1 })
		.toArray();
	const metas = await colls.gameMetadatas.find({}, { projection: { label: 1, alias: 1 } }).toArray();
	const metaByGame = new Map(metas.map((m) => [m._id, m]));
	ctx.body = versions.map((v) => {
		const meta = metaByGame.get(v._id.game);
		return { _id: v._id, label: meta?.label ?? v._id.game, alias: meta?.alias, meta: v.meta };
	});
});

// The per-game metadata (label/alias/description/rules/links/players/needOwnership)
// is edited from the boardgame list page, not a version page (#298). Accept a
// subset of `gameMetadataSchema`; `alias: null` clears it (same upsert convention
// as the version route). Kept loose like the version route: only the fields the
// admin actually edits are validated, the rest round-trips untouched.
const metadataBodySchema = z.looseObject({
	label: gameInfoSchema.shape.label.optional(),
	alias: gameInfoSchema.shape.alias.nullable().optional(),
	description: gameInfoSchema.shape.description.optional(),
	rules: gameInfoSchema.shape.rules.optional(),
	links: gameInfoSchema.shape.links.optional(),
	players: gameInfoSchema.shape.players.optional(),
	needOwnership: gameInfoSchema.shape.needOwnership.optional(),
});

router.get("/:game/meta", async (ctx) => {
	const doc = await colls.gameMetadatas.findOne({ _id: ctx.params.game });
	ctx.body = doc ?? null;
});

router.put("/:game/meta", async (ctx) => {
	const game = ctx.params.game;
	// The editor round-trips the GET response, so strip the server-managed fields:
	// `_id` is immutable, timestamps are wrapper-managed, and `likeCount` is owned by
	// the like/unlike service — a `$set` here would clobber it with a stale snapshot.
	const body = omit(metadataBodySchema.parse(ctx.request.body), "_id", "createdAt", "updatedAt", "likeCount");

	// Guard against orphan metadata docs (typo'd game name in scripted use): the
	// game must exist as at least one version doc.
	const exists = await colls.gameInfos.findOne({ "_id.game": game }, { projection: { _id: 1 } });
	if (!exists) {
		throw createError(404, `No game info for ${game} — save a version first`);
	}

	const $set: Record<string, unknown> = {};
	const $unset: Record<string, true> = {};
	for (const [key, value] of Object.entries(body)) {
		if (value === null) {
			$unset[key] = true;
		} else {
			$set[key] = value;
		}
	}

	const doc = await colls.gameMetadatas.findOneAndUpdate(
		{ _id: game },
		{
			$setOnInsert: { _id: game },
			...(Object.keys($set).length ? { $set } : {}),
			...(Object.keys($unset).length ? { $unset } : {}),
		},
		{ upsert: true, returnDocument: "after" },
	);
	ctx.body = doc;
});

// Fields that are REMOVED from the doc when the admin sends them as null (the JSON
// body can't carry undefined, so GameEdit sends null to clear). Anything else null
// would fail the collection's schema validation — only alias is clearable for now.
const NULLABLE_FIELDS = ["alias"] as const;

// Game-level fields live in `gameMetadatas`; everything else is version-scoped and
// lives in `gameInfos` (#298). `_id` is handled separately (version doc gets the
// `{ game, version }` compound id, metadata doc gets the bare game name).

// The game-server installer spawns `npm install <name>@<version>` from
// engine.package — a loose record here let shell metacharacters in the package
// name reach the spawn (issue #270). Validate the engine sub-object (npm name
// grammar + pinned semver) whenever it is present; the rest of the gameInfo
// stays a loose record.
const upsertBodySchema = z.looseObject({
	alias: gameInfoSchema.shape.alias.nullable(),
	engine: gameInfoSchema.shape.engine, // optional, like on gameInfo
});

function splitBody(body: Record<string, unknown>): {
	metadata: Record<string, unknown>;
	version: Record<string, unknown>;
} {
	const metadata: Record<string, unknown> = {};
	const version: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if ((GAME_METADATA_FIELDS as readonly string[]).includes(key)) {
			metadata[key] = value;
		} else {
			version[key] = value;
		}
	}
	return { metadata, version };
}

async function upsert(ctx: Context) {
	const game = ctx.params.game;
	const version = +ctx.params.version;
	// `likeCount` is stripped for the same reason as the timestamps: the version page
	// GETs the *merged* doc, so a save/duplicate round-trips it — without the strip it
	// would be `$set` onto the version doc (the #289 shape all over again).
	const body = omit(upsertBodySchema.parse(ctx.request.body), "_id", "createdAt", "updatedAt", "likeCount");
	// meta is flattened into dotted paths: a whole-object `$set: { meta }` would
	// wipe server-managed subfields — meta.archived (toggled only by the
	// archive/unarchive action below, which has preconditions — a save must not
	// set or clear it) and meta.bots (auto-detected by the game-server
	// installer).
	if (body.meta && typeof body.meta === "object") {
		for (const [key, value] of Object.entries(body.meta)) {
			if (key === "archived") {
				continue;
			}
			body[`meta.${key}`] = value;
		}
		delete body.meta;
	}
	const { metadata, version: versionFields } = splitBody(body);

	const metadataUnset: Record<string, true> = {};
	for (const field of NULLABLE_FIELDS) {
		if (metadata[field] === null) {
			delete metadata[field];
			metadataUnset[field] = true;
		}
	}

	const versionDoc = await colls.gameInfos.findOneAndUpdate(
		{ _id: { game, version } },
		{ $set: versionFields },
		{ upsert: true, returnDocument: "after" },
	);

	if (versionDoc) {
		// `_id` is fixed by the filter; it must go through `$setOnInsert` (never
		// `$set` — Mongo rejects mutating the immutable `_id`). Only metadata fields
		// actually present in the request are `$set`, so a version-page save that
		// doesn't carry game-level fields leaves existing metadata untouched (#298).
		const metadataUpdate: Record<string, unknown> = { $setOnInsert: { _id: game } };
		if (Object.keys(metadata).length > 0) {
			metadataUpdate.$set = metadata;
		}
		if (Object.keys(metadataUnset).length > 0) {
			metadataUpdate.$unset = metadataUnset;
		}
		await colls.gameMetadatas.updateOne({ _id: game }, metadataUpdate, { upsert: true });
	}

	const merged = await findGameInfoWithVersion(game, version);
	ctx.body = merged ?? versionDoc;
}

// -- Private beta grants -------------------------------------------------------
// Beta access is a per-(user, game) gamePreferences `access.maxVersion` grant:
// the grantee sees versions up to maxVersion even when they are not public
// (lastAccessibleVersion). These routes only manage the grants — access
// semantics stay in services/gameinfo.ts. They are registered BEFORE
// /:game/:version, which would otherwise swallow "beta-users" as a version.

// GET /api/admin/gameinfo/:game/beta-users — users holding a grant for this game.
router.get("/:game/beta-users", async (ctx) => {
	const game = ctx.params.game;

	if (!(await colls.gameInfos.countDocuments({ "_id.game": game }))) {
		throw createError(404, `No game info for ${game}`);
	}

	const grants = await colls.gamePreferences
		.find({ game, "access.maxVersion": { $exists: true } }, { projection: { user: 1, "access.maxVersion": 1 } })
		.toArray();

	const users = await colls.users
		.find({ _id: { $in: grants.map((g) => g.user) } }, { projection: { "account.username": 1 } })
		.toArray();
	const usernameById = new Map(users.map((u) => [u._id.toHexString(), u.account.username]));

	ctx.body = grants
		.map((g) => ({
			userId: g.user,
			username: usernameById.get(g.user.toHexString()) ?? null,
			maxVersion: g.access!.maxVersion!,
		}))
		.sort((a, b) => (a.username ?? "").localeCompare(b.username ?? ""));
});

// POST /api/admin/gameinfo/:game/beta-users — invite a user (username or email)
// to the beta: grants access to the latest version. No-op when the latest
// version is public (there is no beta to join), mirroring the user-centric
// grant route.
router.post("/:game/beta-users", async (ctx) => {
	const game = ctx.params.game;
	const { usernameOrEmail } = z.object({ usernameOrEmail: z.string().min(1) }).parse(ctx.request.body);

	const gameInfo = await findGameInfoWithVersion(game, "latest");
	if (!gameInfo) {
		throw createError(404, `No game info for ${game}`);
	}

	const user = usernameOrEmail.includes("@")
		? await findByEmail(usernameOrEmail)
		: await findByUsername(usernameOrEmail);
	if (!user) {
		throw createError(404, `User not found: ${usernameOrEmail}`);
	}

	if (!gameInfo.public) {
		await colls.gamePreferences.updateOne(
			{ user: user._id, game },
			{ $set: { "access.maxVersion": gameInfo._id.version } },
			{ upsert: true },
		);
	}

	ctx.body = { userId: user._id, username: user.account.username, maxVersion: gameInfo._id.version };
});

// DELETE /api/admin/gameinfo/:game/beta-users/:userId — revoke a user's grant.
router.delete("/:game/beta-users/:userId", async (ctx) => {
	const game = ctx.params.game;

	if (!(await colls.gameInfos.countDocuments({ "_id.game": game }))) {
		throw createError(404, `No game info for ${game}`);
	}

	await colls.gamePreferences.updateOne(
		{ user: new ObjectId(ctx.params.userId), game },
		{ $unset: { "access.maxVersion": true } },
	);
	ctx.status = 200;
});

// GET /api/admin/gameinfo/:game/ongoing-games — per-version count of ongoing
// (open + active) games, one $group aggregation (same semantics as the archive
// route's per-version countDocuments below). Powers the count badges on the
// admin game page's version tabs. Registered BEFORE /:game/:version, which
// would otherwise swallow "ongoing-games" as a version (#319).
router.get("/:game/ongoing-games", async (ctx) => {
	const counts = await colls.games
		.aggregate<{ _id: number; count: number }>([
			{ $match: { "game.name": ctx.params.game, status: { $in: ["open", "active"] } } },
			{ $group: { _id: "$game.version", count: { $sum: 1 } } },
		])
		.toArray();
	ctx.body = counts.map((c) => ({ version: c._id, count: c.count })).sort((a, b) => a.version - b.version);
});

// oxlint-disable no-async-endpoint-handlers -- Express-specific rule; Koa awaits async middleware natively
router.post("/:game/:version", upsert);
router.put("/:game/:version", upsert);
// oxlint-enable no-async-endpoint-handlers

router.delete("/:game/:version", async (ctx) => {
	await colls.gameInfos.deleteOne({ _id: { game: ctx.params.game, version: +ctx.params.version } });
	ctx.status = 200;
});

router.get("/:game/:version", async (ctx) => {
	const game = await findGameInfoWithVersion(ctx.params.game, +ctx.params.version);

	if (game) {
		ctx.body = game;
	} // else 404
});

// -- Archive / unarchive -------------------------------------------------------
// An archived version is skipped by the game-server engine installer (and a
// previously-installed engine is pruned) and is never picked as the latest
// public version, but its viewer keeps being served so old games stay
// replayable. Preconditions (409): the version must not be the current latest
// public one — a hard block, archiving the current version is never allowed.
// Ongoing games are a soft block: without an override the route answers 409
// with a structured body ({ error: "ongoing_games", count, message }) so the
// admin UI can confirm-and-proceed; the caller acknowledges by re-POSTing with
// { force: true }, which skips the ongoing-games check and archives anyway.
// The action never touches the ongoing games themselves.
const archiveBodySchema = z.object({ force: z.boolean().optional() }).nullish();

router.post("/:game/:version/archive", async (ctx) => {
	const game = ctx.params.game;
	const version = +ctx.params.version;
	const force = archiveBodySchema.parse(ctx.request.body)?.force === true;

	const info = await colls.gameInfos.findOne({ _id: { game, version } }, { projection: { _id: 1 } });
	if (!info) {
		throw createError(404, `No game info for ${game} v${version}`);
	}

	const latest = await lastAccessibleVersion(game);
	if (latest?._id.version === version) {
		throw createError(409, `Cannot archive ${game} v${version}: it is the latest public version`);
	}

	if (!force) {
		const ongoing = await colls.games.countDocuments({
			"game.name": game,
			"game.version": version,
			status: { $in: ["open", "active"] },
		});
		if (ongoing > 0) {
			// Not thrown through createError: the global error handler only keeps
			// `message`, and the admin UI needs the structured error/count fields.
			ctx.status = 409;
			ctx.body = {
				error: "ongoing_games",
				count: ongoing,
				message: `Cannot archive ${game} v${version}: ${ongoing} ongoing game(s) on this version`,
			};
			return;
		}
	}

	ctx.body = await colls.gameInfos.findOneAndUpdate(
		{ _id: { game, version } },
		{ $set: { "meta.archived": true } },
		{ returnDocument: "after" },
	);
});

router.post("/:game/:version/unarchive", async (ctx) => {
	const game = ctx.params.game;
	const version = +ctx.params.version;

	const info = await colls.gameInfos.findOne({ _id: { game, version } }, { projection: { _id: 1 } });
	if (!info) {
		throw createError(404, `No game info for ${game} v${version}`);
	}

	ctx.body = await colls.gameInfos.findOneAndUpdate(
		{ _id: { game, version } },
		{ $unset: { "meta.archived": true } },
		{ returnDocument: "after" },
	);
});

// -- Bundle uploads (#268) ------------------------------------------------------
// Raw-body endpoints (koa-bodyparser only parses JSON; like the avatar upload,
// the bytes are streamed off ctx.req). Paths are in CSRF_JSON_EXEMPT (app.ts):
// cookie-authenticated POSTs with non-JSON bodies, gated by isAdmin upstream.
// Bundle keys embed a content hash, so a re-upload produces fresh, cache-busted
// URLs; stale objects stay in the bucket until the operator prunes them.

const VIEWER_FILE_MAX_BYTES = 25 * 1024 * 1024;
const ENGINE_TARBALL_MAX_BYTES = 50 * 1024 * 1024;
// Game ids land in S3 keys and URLs — refuse anything that could break out of
// the games/<game>/ prefix or poison a URL.
const GAME_ID_PATTERN = /^[a-z0-9-]+$/;

async function readBody(ctx: Context, maxBytes: number): Promise<Buffer> {
	const parts: Buffer[] = [];
	let size = 0;
	for await (const chunk of ctx.req) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a readable stream yields Buffer|string; Buffer.from covers both
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
		size += buf.length;
		if (size > maxBytes) {
			throw createError(413, `File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
		}
		parts.push(buf);
	}
	return Buffer.concat(parts);
}

function contentHash(body: Buffer): string {
	return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

function assertBundleTarget(ctx: Context): { game: string; version: number } {
	if (!s3Enabled()) {
		throw createError(503, "Bundle uploads need S3 storage — it is not configured on this server");
	}
	const { game, version } = ctx.params;
	if (!GAME_ID_PATTERN.test(game) || !Number.isInteger(+version) || +version < 1) {
		throw createError(400, "Invalid game id or version");
	}
	return { game, version: +version };
}

function requirePublicUrl(key: string): string {
	const url = publicObjectUrl(key);
	// s3Enabled() is true but no public base URL (e.g. S3_BUCKET unset in a
	// test-less env) — the uploaded object would be unreachable.
	if (!url) {
		throw createError(503, "No public S3 endpoint configured — the uploaded bundle would not be reachable");
	}
	return url;
}

const viewerFileQuerySchema = z.object({
	filename: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(js|css|map)$/, "filename must end in .js, .css or .map"),
	alternate: z.string().optional(),
});

const VIEWER_CONTENT_TYPES: Record<string, string> = {
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".map": "application/json; charset=utf-8",
};

// Uploads ONE viewer bundle file (the built JS, a CSS dependency, or a
// sourcemap) and returns its hosted URL. Persists nothing — the admin UI
// writes the URL into viewer.url / dependencies.stylesheets and the normal
// Save persists it. `.map` files are only uploaded for browser-devtools
// debugging; nothing references them server-side — the built viewer JS must
// point at the map via `//# sourceMappingURL=<hosted .map URL>` (a bare
// `foo.js.map` filename resolves against the hosted JS URL, which shares the
// directory when uploaded for the same viewer).
router.post("/:game/:version/viewer/file", async (ctx) => {
	const { game, version } = assertBundleTarget(ctx);
	const { filename, alternate } = viewerFileQuerySchema.parse(ctx.query);
	const body = await readBody(ctx, VIEWER_FILE_MAX_BYTES);
	if (body.length === 0) {
		throw createError(400, "Empty file");
	}

	const ext = path.extname(filename);
	const key = gameBundleS3Key(
		game,
		version,
		alternate === "1" ? "viewer-alternate" : "viewer",
		contentHash(body),
		filename,
	);
	await putObject(key, body, VIEWER_CONTENT_TYPES[ext]);
	ctx.body = { url: requirePublicUrl(key) };
});

const execFileAsync = promisify(execFile);

// Reads name/version out of an `npm pack` tarball (gzip of a single package/
// root holding a package.json) — the engine doc mirrors those so the install
// path / cache-bust key match the tarball's own identity.
async function readTarballPackage(tarball: Buffer): Promise<{ name: string; version: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bgs-engine-"));
	try {
		const file = path.join(dir, "engine.tgz");
		await fs.promises.writeFile(file, tarball);
		// Read from the archive without extracting: no path traversal possible.
		const { stdout } = await execFileAsync("tar", ["-xzOf", file, "package/package.json"], {
			maxBuffer: 1024 * 1024,
		});
		// name/version are validated against the same npm-name/semver schemas as the
		// upsert route (#270): they land in engine.package and the game-server
		// installer builds npm argv from them.
		const pkg = z.object({ name: npmPackageNameSchema, version: engineVersionSchema }).parse(JSON.parse(stdout));
		return pkg;
	} catch (err) {
		if (err instanceof createError.HttpError) {
			throw err;
		}
		throw createError(
			400,
			"Not a valid npm pack tarball (expected gzip with package/package.json holding a valid npm name+semver version)",
		);
	} finally {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
}

// Uploads an engine `npm pack` tarball and points the game's engine at it:
// engine.package becomes { name, version, url } read from the tarball. The
// game-server installer npm-installs from that URL instead of the registry.
router.post("/:game/:version/engine", async (ctx) => {
	const { game, version } = assertBundleTarget(ctx);
	const body = await readBody(ctx, ENGINE_TARBALL_MAX_BYTES);
	if (body.length === 0) {
		throw createError(400, "Empty file");
	}

	const pkg = await readTarballPackage(body);

	// Check the game exists BEFORE storing anything — an unknown game must not
	// orphan the tarball in S3.
	const existing = await colls.gameInfos.findOne({ _id: { game, version } }, { projection: { _id: 1 } });
	if (!existing) {
		throw createError(404, `No game info for ${game} v${version} — save the game first`);
	}

	const key = gameBundleS3Key(
		game,
		version,
		"engine",
		contentHash(body),
		`${pkg.name.replace(/^@/, "").replace(/\//g, "-")}-${pkg.version}.tgz`,
	);
	await putObject(key, body, "application/gzip");
	const url = requirePublicUrl(key);

	const doc = await colls.gameInfos.findOneAndUpdate(
		{ _id: { game, version } },
		{ $set: { "engine.package": { name: pkg.name, version: pkg.version, url } } },
		{ returnDocument: "after" },
	);
	ctx.body = doc;
});

export default router;
