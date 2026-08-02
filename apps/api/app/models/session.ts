import type { Context } from "koa";
import { z } from "zod";
import { env } from "../config/index.ts";

/** Long-lived session cookie name (holds the refresh-token code). */
export const SESSION_COOKIE = "refreshToken";

/** Session length — refresh tokens live 120 days, extended by activity (sliding). */
export function refreshTokenDuration() {
	return 120 * 24 * 3600 * 1000;
}

const refreshCookieSchema = z.object({ code: z.string(), expiresAt: z.number().optional() });

/** Extract the refresh-token code from the session cookie value. */
export function parseRefreshCookie(raw: string | undefined): string | null {
	if (!raw) {
		return null;
	}
	try {
		return refreshCookieSchema.parse(JSON.parse(raw)).code;
	} catch {
		return null;
	}
}

/** Set the session cookie (JSON { code, expiresAt }), sliding the expiry forward. */
export function setRefreshCookie(ctx: Context, code: string) {
	const expiresAt = Date.now() + refreshTokenDuration();
	const value = JSON.stringify({ code, expiresAt });
	ctx.cookies.set(SESSION_COOKIE, value, {
		httpOnly: true,
		expires: new Date(expiresAt),
		// secure only in production — over http (localhost dev) a secure cookie is dropped.
		secure: env.isProduction,
		sameSite: true,
		domain: env.isProduction ? env.domain : undefined,
	});
}

/** Clear the session cookie (logout). */
export function clearRefreshCookie(ctx: Context) {
	ctx.cookies.set(SESSION_COOKIE, null, { maxAge: 0, domain: env.isProduction ? env.domain : undefined });
}
