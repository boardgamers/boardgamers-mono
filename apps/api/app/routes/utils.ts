import createError from "http-errors";
import type { Context, Next } from "koa";
import NodeCache from "node-cache";
import { z } from "zod";
import env from "../config/env.ts";
import { isUserAdmin } from "../models/index.ts";
import { recordAttempt } from "../services/ratelimit.ts";

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

const attemptEmailSchema = z.object({ email: z.string().email() });

/**
 * Throttles the public auth endpoints that reveal account existence (login /
 * forget / reset / confirm — issue #195), per client IP and per target email.
 * Runs BEFORE the handler so a flood hits the limiter instead of the user
 * lookup; every attempt counts (not just failures) so a legit user's handful
 * of tries sails through while bulk enumeration stalls.
 *
 * The client IP is ctx.ip — correct behind nginx because app.proxy=true makes
 * Koa read X-Forwarded-For (same source app.ts already records for logins).
 * The 429 message is deliberately generic: it must not confirm or deny the
 * target email's registration.
 */
export async function rateLimitAttempt(ctx: Context, next: Next) {
	const { windowMs, maxPerIp, maxPerEmail } = env.authRateLimit;

	// ctx.request.body is already parsed (bodyparser runs first); a missing/invalid
	// email just skips the per-email bucket — the route's own validation will 400 it.
	const parsed = attemptEmailSchema.safeParse(ctx.request.body ?? {});
	const emailKey = parsed.success ? parsed.data.email.toLowerCase() : undefined;

	const ipResult = await recordAttempt("auth:ip", ctx.ip, { windowMs, max: maxPerIp });
	const emailResult = emailKey ? await recordAttempt("auth:email", emailKey, { windowMs, max: maxPerEmail }) : null;

	if (!ipResult.allowed || (emailResult && !emailResult.allowed)) {
		const retryAfter = Math.max(ipResult.retryAfterSeconds, emailResult?.retryAfterSeconds ?? 0);
		ctx.set("Retry-After", String(retryAfter));
		throw createError(429, "Too many attempts, please try again later");
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
