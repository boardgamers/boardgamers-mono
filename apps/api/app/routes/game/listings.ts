import type { GameStatus } from "@bgs/types";
import { joinAnd } from "@bgs/utils/join-and";
import { removeFalsy } from "@bgs/utils/remove-falsy";
import { Game } from "app/models";
import GameInfoService from "app/services/gameinfo";
import assert from "assert";
import { Context } from "koa";
import Router from "koa-router";
import { queryCount, skipCount } from "../utils";

const router = new Router<Application.DefaultState, Context>();

const filterAccessibleGames = async <T>(userId: T) => {
  const games = await GameInfoService.latestAccessibleGames(userId);

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
  }
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

  return joinAnd(
    ...removeFalsy([
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
    ])
  );
}

router.get("/:status/count", async (ctx) => {
  const conditions: Record<string, unknown> = await gameConditions(ctx.params.status, {
    user: ctx.query.user,
    requester: ctx.state.user?._id,
    boardgame: ctx.query.boardgame,
    maxKarma: ctx.query.maxKarma && +ctx.query.maxKarma,
    maxDuration: ctx.query.maxDuration && +ctx.query.maxDuration,
    minDuration: ctx.query.minDuration && +ctx.query.minDuration,
  });
  ctx.body = await Game.count().where(conditions);
});

router.get("/:status", async (ctx) => {
  const status: GameStatus = ctx.params.status;
  const projection = status === "ended" ? [...Game.basics(), "cancelled"] : Game.basics();
  const sortOrder = status === "open" ? "-createdAt" : "-lastMove";
  const conditions = await gameConditions(status, {
    user: ctx.query.user,
    requester: ctx.state.user?._id,
    boardgame: ctx.query.boardgame,
    maxKarma: ctx.query.maxKarma && +ctx.query.maxKarma,
    maxDuration: ctx.query.maxDuration && +ctx.query.maxDuration,
    minDuration: ctx.query.minDuration && +ctx.query.minDuration,
  });

  if (ctx.query.sample) {
    ctx.body = await Game.aggregate()
      .match(conditions)
      .sample(queryCount(ctx) * 5)
      .project(Object.fromEntries(projection.map((x) => [x, 1])))
      .sort(sortOrder)
      .group({ _id: "$creator", data: { $first: "$$ROOT" } })
      .replaceRoot("$data")
      .sort(sortOrder)
      .limit(queryCount(ctx));
  } else {
    ctx.body = await Game.find()
      .where(conditions)
      .sort(sortOrder)
      .skip(skipCount(ctx))
      .limit(queryCount(ctx))
      .select(projection)
      .lean(true);
  }
});

export default router;
