import { gameStatusSchema, type GameStatus } from "@bgs/models";
import { removeFalsy } from "@bgs/utils/remove-falsy";
import { simplifyFilter } from "@coyotte508/mongo-query";
import { colls } from "../../config/db.ts";
import { gameBasicsProjection } from "../../models/index.ts";
import { latestAccessibleGames } from "../../services/gameinfo.ts";
import assert from "node:assert";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { zIntQuery } from "../../utils/zod.ts";
import { queryCount, skipCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

const listingsParamsSchema = z.object({
  status: gameStatusSchema,
});

const listingsQuerySchema = z.object({
  user: z.string().optional(),
  boardgame: z.string().optional(),
  maxKarma: zIntQuery().optional(),
  maxDuration: zIntQuery().optional(),
  minDuration: zIntQuery().optional(),
  sample: z.string().optional(),
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
    user?: string;
    requester?: T;
    boardgame?: string;
    maxKarma?: number;
    maxDuration?: number;
    minDuration?: number;
  },
) {
  const baseConditions = (() => {
    switch (status) {
      case "active":
        return params.user
          ? { $or: [{ status: "active" }, { "currentPlayers._id": params.user }] }
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

  return simplifyFilter({
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
      params.user && { "players._id": params.user },
      await filterAccessibleGames(params.requester),
    ]),
  }) as Record<string, unknown>;
}

router.get("/:status/count", async (ctx) => {
  const { status } = listingsParamsSchema.parse(ctx.params);
  const query = listingsQuerySchema.parse(ctx.query);
  const conditions: Record<string, unknown> = await gameConditions(status, {
    user: query.user,
    requester: ctx.state.user?._id,
    boardgame: query.boardgame,
    maxKarma: query.maxKarma,
    maxDuration: query.maxDuration,
    minDuration: query.minDuration,
  });
  ctx.body = await colls.games.countDocuments(conditions);
});

router.get("/:status", async (ctx) => {
  const { status } = listingsParamsSchema.parse(ctx.params);
  const query = listingsQuerySchema.parse(ctx.query);
  const projection = status === "ended" ? { ...gameBasicsProjection, cancelled: 1 } : { ...gameBasicsProjection };
  const sortOrder: Record<string, 1 | -1> = status === "open" ? { createdAt: -1 } : { lastMove: -1 };
  const conditions = await gameConditions(status, {
    user: query.user,
    requester: ctx.state.user?._id,
    boardgame: query.boardgame,
    maxKarma: query.maxKarma,
    maxDuration: query.maxDuration,
    minDuration: query.minDuration,
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
