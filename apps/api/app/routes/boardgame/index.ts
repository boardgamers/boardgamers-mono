import createError from "http-errors";
import type { GameMetadataDoc, GamePreferencesDoc, GameVersionDoc } from "@bgs/models";
import type { Context } from "koa";
import Router from "koa-router";
import type { ObjectId } from "mongodb";
import type { PickDeep, SetOptional } from "type-fest";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import env from "../../config/env.ts";
import { likedGameIds, setGameLike } from "../../services/gamelike.ts";
import { createFeedbackTopic, forumUidForUser } from "../../services/forum.ts";
import { lastAccessibleVersion } from "../../services/gameinfo.ts";
import { findGameInfoWithVersion, mergeGameInfo } from "../../models/gameinfo.ts";
import { actionRateLimit } from "../../services/actionratelimit.ts";
import { loggedIn, queryCount, skipCount, usernamesById } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.param("boardgame", async (boardgame, ctx, next) => {
	// Like/unlike also works on requested games (#340) — a game request IS a game
	// you can vote for, and it has no version yet — so those routes resolve the
	// bare game id instead of the merged game-info.
	if (ctx.path.endsWith("/like")) {
		const exists = await colls.gameMetadatas.findOne({ _id: boardgame }, { projection: { _id: 1 } });
		if (!exists) {
			throw createError(404, "Boardgame not found");
		}
		await next();
		return;
	}

	// NOTE (#298): this used to be a two-step pick — a direct `gameInfos` query for
	// the latest public non-archived version, falling back to `lastAccessibleVersion`
	// for private grants. Post-split the routes below serve `foundBoardgame` as the
	// merged GameInfo (label/players/likeCount…), which needs the metadata join —
	// `lastAccessibleVersion` already does it. Two deliberate behavior changes for
	// users with an `access.maxVersion` grant: their granted version now wins over an
	// older latest-public one (consistent with game creation), and the grant path
	// returns a merged doc (it could previously serve a doc missing game-level fields).
	const foundGame = await lastAccessibleVersion(boardgame, ctx.state.user);

	if (!foundGame) {
		throw createError(404, "Boardgame not found");
	}

	ctx.state.foundBoardgame = foundGame;

	await next();
});

async function addLikedFlag<T extends { _id: { game: string } }>(game: T, userId?: ObjectId) {
	if (!userId) {
		return { ...game, liked: false };
	}
	const like = await colls.gameLikes.findOne({ game: game._id.game, user: userId }, { projection: { _id: 1 } });
	return { ...game, liked: !!like };
}

// Game requests (#340) — static segments, registered before the `/:boardgame`
// routes so "request"/"requests" are never captured as a game id.

const requestBodySchema = z.object({
	label: z.string().min(2).max(80),
	description: z.string().max(2000).optional(),
});

// Basic spam guard (#340): no karma minimum to request, so cap how many distinct
// games a user can have open requests on (on top of the actionRateLimit).
const MAX_OPEN_GAME_REQUESTS_PER_USER = 10;

function slugifyGameLabel(label: string): string {
	return label
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.replace(/-+$/g, "");
}

router.post("/request", loggedIn, actionRateLimit("boardgame/request"), async (ctx) => {
	const { label, description } = requestBodySchema.parse(ctx.request.body);
	const user = ctx.state.user!;
	const game = slugifyGameLabel(label);

	if (!game) {
		throw createError(400, "The game name needs at least one letter or digit");
	}

	const existing = await colls.gameMetadatas.findOne({ _id: game }, { projection: { status: 1 } });
	if (existing) {
		throw createError(
			409,
			existing.status === "requested"
				? `"${label}" is already requested — vote for it instead`
				: `"${label}" is already on the site`,
		);
	}

	const openRequests = await colls.gameMetadatas.countDocuments({ status: "requested", requestedBy: user._id });
	if (openRequests >= MAX_OPEN_GAME_REQUESTS_PER_USER) {
		throw createError(429, `You already have ${MAX_OPEN_GAME_REQUESTS_PER_USER} open game requests`);
	}

	// Like site/game feedback (#340), the request's forum topic is posted AS the
	// user, so they need a linked forum account (created lazily via BGS OAuth on
	// first forum login). Hard gate: without one the frontend starts the linking flow.
	const forumUid = await forumUidForUser(user._id);
	if (forumUid === null) {
		throw createError(403, "Link your forum account to request a game", { code: "forum_account_required" });
	}

	// Auto-like by the requester: insert the like first so a retry (the metadata
	// insert winning the race but the response getting lost) stays consistent, and
	// store the denormalized count directly on the requested-game doc.
	await colls.gameLikes.insertOne({ game, user: user._id, createdAt: new Date() });
	const doc: GameMetadataDoc = {
		_id: game,
		label,
		...(description ? { description } : {}),
		players: [],
		status: "requested",
		requestedBy: user._id,
		likeCount: 1,
	};
	try {
		await colls.gameMetadatas.insertOne(doc);
	} catch (err) {
		// Concurrent request for the same slug lost the race — report the conflict.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caught errors are untyped; the driver sets `code`
		if ((err as { code?: number })?.code === 11000) {
			throw createError(409, `"${label}" is already requested — vote for it instead`);
		}
		throw err;
	}

	// Auto-create the forum discussion topic, posted AS the requester (#340).
	// Fail-safe: a forum outage never fails the request — it just stays without
	// a topic.
	const topic = await createFeedbackTopic({
		title: label,
		body: description,
		requestUrl: `https://${env.site}/feedback`,
		username: user.account.username,
		forumUid,
	});
	if (topic) {
		await colls.gameMetadatas.updateOne({ _id: game }, { $set: { forumTid: topic.tid } });
		doc.forumTid = topic.tid;
	}

	ctx.status = 201;
	ctx.body = { ...doc, liked: true };
});

router.get("/requests", async (ctx) => {
	const requests = await colls.gameMetadatas
		.find(
			{ status: "requested" },
			{ projection: { label: 1, description: 1, likeCount: 1, requestedBy: 1, forumTid: 1, createdAt: 1 } },
		)
		.sort({ likeCount: -1, createdAt: 1 })
		.toArray();

	const liked = ctx.state.user ? await likedGameIds(ctx.state.user._id) : new Set<string>();
	const requesterNames = await usernamesById(requests.map((r) => r.requestedBy).filter((id) => id !== undefined));

	ctx.body = requests.map((r) => ({
		_id: r._id,
		label: r.label,
		...(r.description ? { description: r.description } : {}),
		likeCount: r.likeCount ?? 0,
		liked: liked.has(r._id),
		...(r.requestedBy ? { requestedBy: requesterNames.get(r.requestedBy.toHexString()) } : {}),
		...(r.forumTid !== undefined ? { forumTid: r.forumTid } : {}),
		createdAt: r.createdAt,
	}));
});

router.get("/info", async (ctx) => {
	const ownGames = ctx.state.user
		? await colls.gamePreferences
				.find({
					user: ctx.state.user._id,
					"access.maxVersion": { $exists: true },
				})
				.project<PickDeep<GamePreferencesDoc, "game" | "access.maxVersion">>({ game: 1, "access.maxVersion": 1 })
				.toArray()
		: [];
	// Archived versions are excluded (same "never the current version" rule as
	// lastAccessibleVersion): the web computes each game's "latest" from this
	// list, so an archived doc here could be offered at game creation. Old games
	// on an archived version don't read this list — they fetch their exact
	// version doc via /boardgame/:game/info/:version.
	const versions = await colls.gameInfos
		.find({
			"meta.archived": { $ne: true },
			$or: [
				{ public: true },
				...ownGames.map((game) => ({ _id: { game: game.game, version: game.access!.maxVersion } })),
			],
		})
		.project<SetOptional<GameVersionDoc, "viewer">>({ viewer: 0 })
		.sort({ "_id.game": 1, "_id.version": -1 })
		.toArray();
	// Requested games (#340) are excluded: a request is not a playable game and
	// only implemented games (status absent = implemented) appear in the list.
	const metas = await colls.gameMetadatas.find({ status: { $ne: "requested" } }).toArray();
	const metaByGame = new Map(metas.map((m) => [m._id, m]));
	const liked = ctx.state.user ? await likedGameIds(ctx.state.user._id) : new Set<string>();
	// The list projection drops `viewer` (the endpoint never serves it), so the
	// merged doc legitimately lacks it — mergeGameInfo only spreads fields through.
	ctx.body = versions.map((v) => ({
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- viewer is intentionally omitted from the list
		...mergeGameInfo(v as GameVersionDoc, metaByGame.get(v._id.game) ?? null),
		liked: liked.has(v._id.game),
	}));
});

router.post("/:boardgame/like", loggedIn, actionRateLimit("boardgame/like"), async (ctx) => {
	ctx.body = await setGameLike(ctx.params.boardgame, ctx.state.user!._id, true);
});

router.delete("/:boardgame/like", loggedIn, actionRateLimit("boardgame/like"), async (ctx) => {
	ctx.body = await setGameLike(ctx.params.boardgame, ctx.state.user!._id, false);
});

router.get("/:boardgame", async (ctx) => {
	ctx.body = await addLikedFlag(ctx.state.foundBoardgame!, ctx.state.user?._id);
});

router.get("/:boardgame/info", async (ctx) => {
	ctx.body = await addLikedFlag(ctx.state.foundBoardgame!, ctx.state.user?._id);
});

router.get("/:boardgame/info/latest", async (ctx) => {
	const game = await lastAccessibleVersion(ctx.params.boardgame, ctx.state.user);

	if (game) {
		ctx.body = game;
	} // else 404
});

router.get("/:boardgame/elo", async (ctx) => {
	const boardgameName = ctx.state.foundBoardgame!._id.game;
	ctx.body = await colls.gamePreferences
		.aggregate([
			{
				$match: {
					game: boardgameName,
					"elo.value": { $gt: 0 },
				},
			},
			{
				$sort: {
					"elo.value": -1,
				},
			},
			{
				$skip: skipCount(ctx),
			},
			{
				$limit: queryCount(ctx),
			},
			{
				$lookup: {
					from: "users",
					localField: "user",
					foreignField: "_id",
					as: "userData",
				},
			},
			{
				$unwind: "$userData",
			},
			{
				$project: {
					elo: 1,
					"access.ownership": 1,
					"user.name": "$userData.account.username",
					"user._id": "$userData._id",
					"user.country": "$userData.account.country",
				},
			},
		])
		.toArray();
});

router.get("/:boardgame/elo/count", async (ctx) => {
	const boardgameName = ctx.state.foundBoardgame!._id.game;
	ctx.body = await colls.gamePreferences.countDocuments({ game: boardgameName, "elo.value": { $gt: 0 } });
});

router.get("/:boardgame/info/:version", async (ctx) => {
	const game = await findGameInfoWithVersion(ctx.params.boardgame, +ctx.params.version);

	if (game) {
		ctx.body = game;
	} // else 404
});

export default router;
