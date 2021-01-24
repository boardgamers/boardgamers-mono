import { Context, Next } from "koa";
import createError from "http-errors";

export async function loggedIn(ctx: Context, next: Next) {
  if (!ctx.state.user) {
    throw createError(401, "You need to be logged in");
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
  if (!ctx.state.user || !ctx.state.user.isAdmin) {
    throw createError(403, "You need to be admin");
  }

  await next();
}

// export function queryCount(ctx: Context, max = 20) {
//   return Math.max(Math.min(+ctx.query.count || 20, max), 1);
// }

// export function skipCount(ctx: Context) {
//   return +ctx.query.skip || 0;
// }
