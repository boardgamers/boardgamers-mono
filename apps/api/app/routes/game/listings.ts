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
				// A game on a version above the requester's accessible ceiling (e.g. a
				// private-beta version) is hidden from their lists — UNLESS they're a
				// player in it. Being in `players` (including a pending invite) must
				// surface the game so the invitee can find and accept it, mirroring the
				// `options.meta.unlisted` player bypass in gameConditions below.
				$or: [
					// Only a logged-in requester can be a player; skip the clause for
					// anonymous requests so `players._id: undefined` matches nothing.
					...(userId ? [{ "players._id": userId }] : []),
					...[...games.entries()].map(([game, version]) => ({ "game.name": game, "game.version": { $lte: version } })),
				],
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

const byRecency = (a: { lastActivity: Date }, b: { lastActivity: Date }) =>
	b.lastActivity.getTime() - a.lastActivity.getTime();
const maxDate = (a: Date, b?: Date) => (b && b > a ? b : a);

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
		])
		.toArray();

	// Personal ordering (#117): "My games, freshest first" — each boardgame's sort key
	// is the MOST RECENT of its last-played time and its like time, so a liked game
	// that was never played still shows up, and a liked game surfaces by whichever
	// signal is fresher. Each row carries both `lastPlayedAt` (raw play recency) and
	// `likedAt` so the sidebar derives the same blended ordering; `lastActivity` is
	// the blended max (kept for back-compat).
	// Requested games (#340) are excluded: a request is not a playable game and
	// never appears in the sidebar (voting on requests happens on the requests
	// page). Beta games have an implementation and DO appear when liked/played.
	const likes = await colls.gameLikes.find({ user }, { projection: { game: 1, createdAt: 1 } }).toArray();
	const requested = new Set(
		likes.length === 0
			? []
			: await colls.gameMetadatas
					.find({ _id: { $in: likes.map((l) => l.game) }, status: "requested" }, { projection: { _id: 1 } })
					.toArray()
					.then((metas) => metas.map((m) => m._id)),
	);
	const playableLikes = likes.filter((l) => !requested.has(l.game));
	const likeByGame = new Map(playableLikes.map((l) => [l.game, l.createdAt ?? new Date(0)]));

	ctx.body = [
		...results.map((r) => ({ boardgame: r._id, lastPlayedAt: r.lastActivity as Date | undefined })),
		...playableLikes
			.filter((l) => !results.some((r) => r._id === l.game))
			.map((l) => ({ boardgame: l.game, lastPlayedAt: undefined as Date | undefined })),
	]
		.map((r) => {
			const likedAt = likeByGame.get(r.boardgame);
			return {
				boardgame: r.boardgame,
				liked: likedAt !== undefined,
				...(r.lastPlayedAt && { lastPlayedAt: r.lastPlayedAt }),
				...(likedAt && { likedAt }),
				lastActivity: maxDate(r.lastPlayedAt ?? new Date(0), likedAt),
			};
		})
		.sort(byRecency);
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
		const count = queryCount(ctx);
		const pipeline = [
			{ $match: conditions },
			{ $sample: { size: count * 5 } },
			{ $project: projection },
			{ $sort: sortOrder },
			// Split into the first game per creator and the rest (same-author repeats),
			// then concatenate: variety first, and the repeats only fill the remaining
			// slots. So a lobby with FEW open games (< count) shows same-author games to
			// fill the page, while a busy lobby keeps one-game-per-creator variety.
			{
				$group: {
					_id: "$creator",
					first: { $first: "$$ROOT" },
					rest: { $push: "$$ROOT" },
				},
			},
			{
				$project: {
					first: 1,
					rest: { $slice: ["$rest", 1, { $size: "$rest" }] },
				},
			},
			{
				$group: {
					_id: null,
					firsts: { $push: "$first" },
					rests: { $push: "$rest" },
				},
			},
			{
				$project: {
					games: {
						$concatArrays: [
							"$firsts",
							{ $reduce: { input: "$rests", initialValue: [], in: { $concatArrays: ["$$value", "$$this"] } } },
						],
					},
				},
			},
			{ $unwind: "$games" },
			{ $replaceRoot: { newRoot: "$games" } },
			{ $limit: count },
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
