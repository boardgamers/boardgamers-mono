import { gameStatusSchema, type GameDoc, type GameStatus } from "@bgs/models";
import { removeFalsy } from "@bgs/utils/remove-falsy";
import { simplifyFilter } from "@coyotte508/mongo-query";
import type { Filter, ObjectId, WithId } from "mongodb";
import { colls } from "../../config/db.ts";
import { gameBasicsProjection } from "../../models/index.ts";
import { latestAccessibleGames } from "../../services/gameinfo.ts";
import assert from "node:assert";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { zIntQuery, zObjectId } from "../../utils/zod.ts";
import { queryCount, skipCount } from "../utils.ts";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const router = new Router<Application.DefaultState, Context>();

const listingsParamsSchema = z.object({
	status: gameStatusSchema,
});

const listingsQuerySchema = z.object({
	user: zObjectId().optional(),
	boardgame: z.string().optional(),
	maxKarma: zIntQuery().optional(),
	maxDuration: zIntQuery().optional(),
	minDuration: zIntQuery().optional(),
	sample: z.string().optional(),
	search: z.string().optional(),
});

const filterAccessibleGames = async <T>(userId: T) => {
	const games = await latestAccessibleGames(userId);

	if (!games.size) {
		return {};
	}

	return {
		$and: [
			{
				$or: [...games.entries()].map(([game, version]) => ({ "game.name": game, "game.version": { $lte: version } })),
			},
		],
	};
};

/**
 * MongoDB conditions to find games matching params
 */
async function gameConditions<T>(
	status: GameStatus,
	params: {
		userId?: ObjectId;
		requester?: T;
		boardgame?: string;
		maxKarma?: number;
		maxDuration?: number;
		minDuration?: number;
		search?: string;
	},
) {
	const baseConditions = (() => {
		switch (status) {
			case "active":
				return params.userId
					? { $or: [{ status: "active" }, { "currentPlayers._id": params.userId }] }
					: { status: "active" };
			case "ended":
				return { status: "ended" };
			case "open":
				return {
					status: "open",
					$or: [{ "options.meta.unlisted": { $ne: true } }, { "players._id": params.requester }],
				};
			default:
				assert(false, "Wrong status requested: " + status);
		}
	})();

	// The conditions are a heterogeneous mix (status/karma/duration/search filters);
	// loosen to a plain Mongo filter so simplifyFilter accepts them, and return that
	// shape so callers can pass it straight to .find()/.aggregate().
	const conditions = {
		$and: removeFalsy([
			baseConditions,
			params.maxKarma && {
				$or: [
					{ "players._id": params.requester },
					{ "options.meta.minimumKarma": { $lte: +params.maxKarma } },
					{ "options.meta.minimumKarma": { $exists: false } },
				],
			},
			params.minDuration && { "options.timing.timePerGame": { $gte: params.minDuration } },
			params.maxDuration && { "options.timing.timePerGame": { $lte: params.maxDuration } },
			params.boardgame && { "game.name": params.boardgame },
			params.userId && { "players._id": params.userId },
			params.search && { _id: { $regex: escapeRegex(params.search), $options: "i" } },
			await filterAccessibleGames(params.requester),
		]),
	};

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- heterogeneous $and mix is deliberately loosened to a Mongo filter
	return simplifyFilter(conditions as Filter<WithId<GameDoc>>);
}

const myBoardgamesQuerySchema = z.object({
	user: zObjectId(),
});

// Cap on how many of the player's most recent games the aggregation scans. The
// $match+$sort+$limit run on the { "players._id": 1, lastMove: -1 } index, so the
// $group only ever sees ≤ this many index-sorted docs — bounded cost regardless of
// total history. Trade-off: a boardgame only played beyond this window won't appear
// in the pinned list, which is fine for a "recently played" sidebar.
const MY_BOARDGAMES_SCAN = 100;

/**
 * Boardgames a player has recently played, ordered by most recent activity. Powers
 * the sidebar's "your games first" ordering. Approximate by design — see above.
 */
export async function myBoardgames(ctx: Context) {
	const { user } = myBoardgamesQuerySchema.parse(ctx.query);

	const results = await colls.games
		.aggregate<{ _id: string; lastActivity: Date }>([
			{ $match: { "players._id": user } },
			{ $sort: { lastMove: -1 } },
			{ $limit: MY_BOARDGAMES_SCAN },
			{
				$group: {
					_id: "$game.name",
					lastActivity: { $max: { $ifNull: ["$lastMove", "$updatedAt"] } },
				},
			},
			{ $sort: { lastActivity: -1 } },
		])
		.toArray();

	ctx.body = results.map((r) => ({ boardgame: r._id, lastActivity: r.lastActivity }));
}

router.get("/:status/count", async (ctx) => {
	const { status } = listingsParamsSchema.parse(ctx.params);
	const query = listingsQuerySchema.parse(ctx.query);
	const conditions: Record<string, unknown> = await gameConditions(status, {
		userId: query.user,
		requester: ctx.state.user?._id,
		boardgame: query.boardgame,
		maxKarma: query.maxKarma,
		maxDuration: query.maxDuration,
		minDuration: query.minDuration,
		search: query.search,
	});
	ctx.body = await colls.games.countDocuments(conditions);
});

router.get("/:status", async (ctx) => {
	const { status } = listingsParamsSchema.parse(ctx.params);
	const query = listingsQuerySchema.parse(ctx.query);
	const projection = status === "ended" ? { ...gameBasicsProjection, cancelled: 1 } : { ...gameBasicsProjection };
	const sortOrder: Record<string, 1 | -1> = status === "open" ? { createdAt: -1 } : { lastMove: -1 };
	const conditions = await gameConditions(status, {
		userId: query.user,
		requester: ctx.state.user?._id,
		boardgame: query.boardgame,
		maxKarma: query.maxKarma,
		maxDuration: query.maxDuration,
		minDuration: query.minDuration,
		search: query.search,
	});

	if (query.sample) {
		const pipeline = [
			{ $match: conditions },
			{ $sample: { size: queryCount(ctx) * 5 } },
			{ $project: projection },
			{ $sort: sortOrder },
			{ $group: { _id: "$creator", data: { $first: "$$ROOT" } } },
			{ $replaceRoot: { newRoot: "$data" } },
			{ $sort: sortOrder },
			{ $limit: queryCount(ctx) },
		];
		ctx.body = await colls.games.aggregate(pipeline).toArray();
	} else {
		ctx.body = await colls.games
			.find(conditions)
			.sort(sortOrder)
			.skip(skipCount(ctx))
			.limit(queryCount(ctx))
			.project(projection)
			.toArray();
	}
});

export default router;
