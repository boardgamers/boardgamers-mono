import { engineVersionSchema, gameInfoSchema, npmPackageNameSchema } from "@bgs/models";
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
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { findGameInfoWithVersion } from "../../models/index.ts";
import { gameBundleS3Key, publicObjectUrl, putObject, s3Enabled } from "../../services/s3.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
	ctx.body = await colls.gameInfos
		.find({}, { projection: { _id: 1, label: 1 } })
		.sort({ "_id.game": 1, "_id.version": -1 })
		.toArray();
});

// Fields that are REMOVED from the doc when the admin sends them as null (the JSON
// body can't carry undefined, so GameEdit sends null to clear). Anything else null
// would fail the collection's schema validation — only alias is clearable for now.
const NULLABLE_FIELDS = ["alias"] as const;

// The game-server installer spawns `npm install <name>@<version>` from
// engine.package — a loose record here let shell metacharacters in the package
// name reach the spawn (issue #270). Validate the engine sub-object (npm name
// grammar + pinned semver) whenever it is present; the rest of the gameInfo
// stays a loose record.
const upsertBodySchema = z.looseObject({
	alias: gameInfoSchema.shape.alias.nullable(),
	engine: gameInfoSchema.shape.engine, // optional, like on gameInfo
});

async function upsert(ctx: Context) {
	const body = omit(upsertBodySchema.parse(ctx.request.body), "_id", "createdAt", "updatedAt");
	const $unset: Record<string, true> = {};
	for (const field of NULLABLE_FIELDS) {
		if (body[field] === null) {
			delete body[field];
			$unset[field] = true;
		}
	}
	const update: Record<string, unknown> = { $set: body };
	if (Object.keys($unset).length > 0) {
		update.$unset = $unset;
	}
	const game = await colls.gameInfos.findOneAndUpdate(
		{ _id: { game: ctx.params.game, version: +ctx.params.version } },
		update,
		{ upsert: true, returnDocument: "after" },
	);
	ctx.body = game;
}

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
