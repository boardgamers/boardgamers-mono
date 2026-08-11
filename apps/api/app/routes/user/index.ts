import { createHash } from "node:crypto";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { type Binary, ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { generateAvatar } from "../../models/avatar.ts";
import { isAvatarPubliclyReachable, publicAvatarUrl } from "../../services/s3.ts";
import {
	eloProjection,
	findGamesWithPlayersTurn,
	findByUsername,
	gameBasicsProjection,
	publicInfoProjection,
	userPublicInfo,
} from "../../models/index.ts";
import { zIntQuery } from "../../utils/zod.ts";
import { queryCount, skipCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

// Serves avatar bytes with a content-hash ETag + `Cache-Control: no-cache`:
// the browser always revalidates (If-None-Match) → 304 when unchanged (no
// re-download), the fresh image the moment the style or upload changes.
// `etag` lets callers pass a hash stored at upload time, avoiding a re-hash of
// the (potentially large) blob on every request; otherwise it's computed here.
// Returns true when it short-circuited with a 304.
function serveAvatar(ctx: Context, contentType: string, body: Buffer | string, etag?: string): boolean {
	const etagValue = `"${etag ?? createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
	if (setAvatarHeaders(ctx, etagValue)) {
		return true;
	}

	ctx.set("Content-Type", contentType);
	ctx.body = body;
	return false;
}

// Sets the ETag/Cache-Control pair every avatar response carries. Returns true
// (status 304) when the client's revalidation matches — decided purely from the
// stored hash, without touching S3 or mongo bytes.
function setAvatarHeaders(ctx: Context, etagValue: string): boolean {
	ctx.set("ETag", etagValue);
	ctx.set("Cache-Control", "no-cache");

	if (ctx.request.headers["if-none-match"] === etagValue) {
		ctx.status = 304;
		return true;
	}
	return false;
}

// Shared by both avatar routes. Precedence: (1) 304 on the stored hash, (2)
// 302 to the public S3 object URL for migrated avatars once a HEAD probe
// confirms the bucket serves it anonymously (public-read per #218 — creds-less
// envs like PR previews redirect the same way), (3) mongo blob when present,
// (4) DiceBear fallback — a metadata-only (S3-only) doc in an env with no S3
// base URL at all must never 500.
async function serveUploadedAvatar(
	ctx: Context,
	userId: ObjectId,
	format: string,
	item: { images: Record<string, { mime: string; raw?: Buffer | Binary; hash?: string }> | undefined; s3?: boolean },
	fallback: { username: string; size?: number },
) {
	const imageData = item.images?.[format];
	// 304 on revalidation, without touching S3 or the blob.
	if (imageData?.hash && setAvatarHeaders(ctx, `"${imageData.hash}"`)) {
		return;
	}

	if (item.s3) {
		// Redirect to the public object URL whenever the env knows one — with S3
		// creds (prod/dev) or without (previews, anonymous GET) — AND the object
		// is confirmed publicly reachable (operator bucket policy, #218): until
		// the HEAD probe passes, keep serving from mongo. The browser downloads
		// the bytes straight from S3 while the ETag stays the api's content hash
		// (the next revalidation still comes back here → cheap 304).
		const url = publicAvatarUrl(userId.toHexString(), format);
		if (url && (await isAvatarPubliclyReachable(userId.toHexString(), format))) {
			ctx.status = 302;
			ctx.set("Location", url);
			return;
		}
	}

	if (imageData?.raw) {
		const buf = Buffer.isBuffer(imageData.raw) ? imageData.raw : Buffer.from(imageData.raw.buffer);
		serveAvatar(ctx, imageData.mime, buf, imageData.hash);
		return;
	}

	serveAvatar(ctx, "image/svg+xml", generateAvatar(undefined, fallback.username, fallback.size));
}

router.param("userId", async (userId, ctx, next) => {
	ctx.state.foundUser = (await colls.users.findOne({ _id: new ObjectId(userId) })) ?? undefined;

	if (!ctx.state.foundUser) {
		throw createError(404, "User not found");
	}

	await next();
});

router.param("userName", async (userName, ctx, next) => {
	ctx.state.foundUser = (await findByUsername(decodeURIComponent(userName))) ?? undefined;

	if (!ctx.state.foundUser) {
		throw createError(404, "User not found");
	}

	await next();
});

router.get("/search", async (ctx) => {
	const { name } = z.object({ name: z.string().optional() }).parse(ctx.query);

	if (!name) {
		ctx.body = [];
		return;
	}

	const conditions = { "security.slug": new RegExp("^" + name.toLocaleLowerCase()) };

	const usersList = await colls.users.find(conditions).project(publicInfoProjection).limit(queryCount(ctx)).toArray();
	ctx.body = usersList;
});

router.get("/infoByName/:userName", (ctx) => {
	ctx.body = userPublicInfo(ctx.state.foundUser!);
});

// Same as /:userId/avatar but by username — used when the client knows the
// name but not the id (e.g. the avatar-style picker on the account page).
// Generated avatars are style-stable, so this also previews a style via ?style=.
router.get("/byName/:userName/avatar", async (ctx) => {
	const foundUser = ctx.state.foundUser!;
	const account = foundUser.account;
	const { size, style } = z.object({ size: zIntQuery().optional(), style: z.string().optional() }).parse(ctx.query);

	if (!style && account.avatar === "upload") {
		const format = !size || size > 128 ? "256x256" : size > 64 ? "128x128" : "64x64";
		const item = await colls.images.findOne(
			{
				ref: foundUser._id,
				refType: "User",
				key: "avatar",
				[`images.${format}`]: { $exists: true },
			},
			{ projection: { [`images.${format}`]: 1, s3: 1 } },
		);
		if (!item) {
			return;
		}

		await serveUploadedAvatar(ctx, foundUser._id, format, item, {
			username: account.username,
			size: size && size <= 256 ? size : undefined,
		});
		return;
	}

	const svg = generateAvatar(style ?? account.avatar, account.username, size && size <= 256 ? size : undefined);
	serveAvatar(ctx, "image/svg+xml", svg);
});

router.get("/:userId/avatar", async (ctx) => {
	const foundUser = ctx.state.foundUser!;
	const account = foundUser.account;
	const { size } = z.object({ size: zIntQuery().optional() }).parse(ctx.query);

	if (account.avatar === "upload") {
		const format = !size || size > 128 ? "256x256" : size > 64 ? "128x128" : "64x64";
		const item = await colls.images.findOne(
			{
				ref: foundUser._id,
				refType: "User",
				key: "avatar",
				[`images.${format}`]: { $exists: true },
			},
			{ projection: { [`images.${format}`]: 1, s3: 1 } },
		);
		if (!item) {
			return;
		}

		await serveUploadedAvatar(ctx, foundUser._id, format, item, {
			username: account.username,
			size: size && size <= 256 ? size : undefined,
		});
		return;
	}

	// DiceBear avatars are generated locally — deterministic (seeded by username + style),
	// so the ETag only changes when the style does. Revalidation picks that up immediately.
	const svg = generateAvatar(account.avatar, account.username, size && size <= 256 ? size : undefined);
	serveAvatar(ctx, "image/svg+xml", svg);
});

router.get("/:userId/games/open", async (ctx) => {
	const foundUser = ctx.state.foundUser!;
	const conditions: Record<string, unknown> = {
		"players._id": foundUser._id,
		status: "open",
	};

	if (!ctx.state.user?._id?.equals(foundUser._id)) {
		conditions["options.meta.unlisted"] = { $ne: true };
	}

	ctx.body = await colls.games
		.find(conditions)
		.sort({ lastMove: -1 })
		.skip(skipCount(ctx))
		.limit(queryCount(ctx))
		.project(gameBasicsProjection)
		.toArray();
});

router.get("/:userId/games/active", async (ctx) => {
	ctx.body = await colls.games
		.find({ "players._id": ctx.state.foundUser!._id, status: "active" })
		.sort({ lastMove: -1 })
		.skip(skipCount(ctx))
		.limit(queryCount(ctx))
		.project(gameBasicsProjection)
		.toArray();
});

router.get("/:userId/games/current-turn", async (ctx) => {
	ctx.body = await findGamesWithPlayersTurn(ctx.state.foundUser!._id)
		.limit(queryCount(ctx))
		.project(gameBasicsProjection)
		.toArray();
});

router.get("/:userId/games/(ended|closed)", async (ctx) => {
	ctx.body = await colls.games
		.find({ "players._id": ctx.state.foundUser!._id, status: "ended" })
		.sort({ lastMove: -1 })
		.skip(skipCount(ctx))
		.limit(queryCount(ctx))
		.project(gameBasicsProjection)
		.toArray();
});

const gameCountParamsSchema = z.object({
	status: z.enum(["closed", "ended", "dropped"]),
});

const gameCountQuerySchema = z.object({
	since: zIntQuery().optional(),
	game: z.string().optional(),
});

router.get("/:userId/games/count/:status", async (ctx) => {
	const foundUser = ctx.state.foundUser!;
	const { status } = gameCountParamsSchema.parse(ctx.params);
	const { since, game } = gameCountQuerySchema.parse(ctx.query);
	const conditions: Record<string, unknown> = (() => {
		switch (status) {
			case "closed":
			case "ended":
				return { status: "ended", "players._id": foundUser._id };
			case "dropped":
				return {
					players: {
						$elemMatch: {
							_id: foundUser._id,
							dropped: true,
						},
					},
				};
		}
	})();

	if (since !== undefined) {
		conditions.lastMove = {
			$gte: new Date(since),
		};
	}

	if (game) {
		conditions["game.name"] = game;
	}

	ctx.body = await colls.games.countDocuments(conditions);
});

router.get("/:userId/games/elo", async (ctx) => {
	ctx.body = await colls.gamePreferences
		.find({
			user: ctx.state.foundUser!._id,
			"elo.games": { $gt: 0 },
		})
		.skip(skipCount(ctx))
		.limit(queryCount(ctx))
		.project(eloProjection)
		.sort({ game: 1 })
		.toArray();
});

router.get("/:userId/games/access", async (ctx) => {
	ctx.body = await colls.gamePreferences
		.find({ user: ctx.state.foundUser!._id })
		.skip(skipCount(ctx))
		.limit(queryCount(ctx))
		.sort({ game: 1 })
		.project({ game: 1, access: 1 })
		.toArray();
});

export default router;
