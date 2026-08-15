import createError from "http-errors";
import type { GamePreferencesDoc, GameVersionDoc } from "@bgs/models";
import type { Context } from "koa";
import Router from "koa-router";
import type { PickDeep, SetOptional } from "type-fest";
import { colls } from "../../config/db.ts";
import { lastAccessibleVersion } from "../../services/gameinfo.ts";
import { findGameInfoWithVersion, mergeGameInfo } from "../../models/gameinfo.ts";
import { queryCount, skipCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.param("boardgame", async (boardgame, ctx, next) => {
	// NOTE (#298): this used to be a two-step pick — a direct `gameInfos` query for
	// the latest public non-archived version, falling back to `lastAccessibleVersion`
	// for private grants. Post-split the version doc alone is no longer sufficient:
	// the routes below serve `foundBoardgame` as the merged GameInfo (label/players/
	// likeCount…), which needs the metadata join. `lastAccessibleVersion` already
	// does that join AND covers the public pick (it queries the latest public
	// non-archived version first, then the private-grant version), so we call it
	// directly. Behavior is unchanged for public games; the only difference is the
	// private-grant path now also returns a merged doc (previously it could serve a
	// bare version doc missing the game-level fields).
	const foundGame = await lastAccessibleVersion(boardgame, ctx.state.user);

	if (!foundGame) {
		throw createError(404, "Boardgame not found");
	}

	ctx.state.foundBoardgame = foundGame;

	await next();
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
				{ "meta.public": true },
				...ownGames.map((game) => ({ _id: { game: game.game, version: game.access!.maxVersion } })),
			],
		})
		.project<SetOptional<GameVersionDoc, "viewer">>({ viewer: 0 })
		.sort({ "_id.game": 1, "_id.version": -1 })
		.toArray();
	const metas = await colls.gameMetadatas.find({}).toArray();
	const metaByGame = new Map(metas.map((m) => [m._id, m]));
	// The list projection drops `viewer` (the endpoint never serves it), so the
	// merged doc legitimately lacks it — mergeGameInfo only spreads fields through.
	ctx.body = versions.map((v) =>
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- viewer is intentionally omitted from the list
		mergeGameInfo(v as GameVersionDoc, metaByGame.get(v._id.game) ?? null),
	);
});

router.get("/:boardgame", (ctx) => {
	ctx.body = ctx.state.foundBoardgame;
});

router.get("/:boardgame/info", (ctx) => {
	ctx.body = ctx.state.foundBoardgame;
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
