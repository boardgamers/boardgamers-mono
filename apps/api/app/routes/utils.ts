import createError from "http-errors";
import type { Context, Next } from "koa";
import NodeCache from "node-cache";
import { z } from "zod";
import { isUserAdmin } from "../models/index.ts";

export async function loggedIn(ctx: Context, next: Next) {
  if (!ctx.state.user) {
    throw createError(401, "You need to be logged in");
  }

  await next();
}

export async function isConfirmed(ctx: Context, next: Next) {
  if (!ctx.state.user?.security.confirmed) {
    throw createError(403, "You need to confirm your account");
  }

  await next();
}

export async function loggedOut(ctx: Context, next: Next) {
  if (ctx.state.user) {
    throw createError(401, "You need to be logged out");
  }

  await next();
}

export async function isAdmin(ctx: Context, next: Next) {
  if (!ctx.state.user || !isUserAdmin(ctx.state.user)) {
    throw createError(403, "You need to be admin");
  }

  await next();
}

const paginationQuerySchema = z.object({
  count: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
});

export function queryCount(ctx: Context, max = 100) {
  const { count } = paginationQuerySchema.parse(ctx.query);
  return Math.min(count ?? 20, max);
}

export function skipCount(ctx: Context) {
  const { skip } = paginationQuerySchema.parse(ctx.query);
  return skip ?? 0;
}

const internalCache = new NodeCache({ stdTTL: 10 });

/**
 * Decorator to cache a result
 *
 * Could be customized to add a duration in seconds
 * @param target
 */
export function cache(target: (..._: unknown[]) => unknown) {
  return async function (...args: unknown[]) {
    const key = JSON.stringify([target.name, ...args]);
    let val = internalCache.get(key);

    if (val === undefined) {
      val = await target(...args);
      internalCache.set(key, val);
    }
  };
}
