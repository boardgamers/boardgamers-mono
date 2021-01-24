import { Context, Next } from "koa";
import createError from "http-errors";
import NodeCache from "node-cache";

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
  if (!ctx.state.user?.isAdmin()) {
    throw createError(403, "You need to be admin");
  }

  await next();
}

export function queryCount(ctx: Context, max = 100) {
  return Math.max(Math.min(+ctx.query.count || 20, max), 1);
}

export function skipCount(ctx: Context) {
  return +ctx.query.skip || 0;
}

const internalCache = new NodeCache({ stdTTL: 10 });

/**
 * Decorator to cache a result
 *
 * Could be customized to add a duration in seconds
 * @param target
 */
export function cache(target: Function) {
  return async function (...args: any[]) {
    const key = JSON.stringify([target.name, ...args]);
    let val = internalCache.get(key);

    if (val === undefined) {
      val = await target(...args);
      internalCache.set(key, val);
    }
  };
}
