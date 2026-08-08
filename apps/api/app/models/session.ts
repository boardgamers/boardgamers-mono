import type { Context } from "koa";
import net from "node:net";
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

/** True for local requests (localhost / IP) — those get a host-only, non-Secure cookie. */
function isLocalhost(ctx: Context): boolean {
	return ctx.hostname === "localhost" || net.isIP(ctx.hostname) !== 0;
}

/** Set the session cookie (JSON { code, expiresAt }), sliding the expiry forward. */
export function setRefreshCookie(ctx: Context, code: string) {
	const expiresAt = Date.now() + refreshTokenDuration();
	const value = JSON.stringify({ code, expiresAt });
	const local = isLocalhost(ctx);
	ctx.cookies.set(SESSION_COOKIE, value, {
		httpOnly: true,
		expires: new Date(expiresAt),
		secure: !local,
		sameSite: true,
		domain: local ? undefined : env.cookieDomain,
	});
}

/** Clear the session cookie (logout) — same `domain` it was set with, or it won't be removed. */
export function clearRefreshCookie(ctx: Context) {
	ctx.cookies.set(SESSION_COOKIE, null, { maxAge: 0, domain: isLocalhost(ctx) ? undefined : env.cookieDomain });
}

/**
 * Clear every variant of the session cookie: the current domain-scoped one AND the
 * host-only one set by pre-overhaul deployments. A lingering host-only duplicate sorts
 * first in the Cookie header and shadows the fresh domain cookie on every request,
 * locking the browser out of login until it expires (120 days).
 */
export function clearAllRefreshCookieVariants(ctx: Context) {
	clearRefreshCookie(ctx);
	if (!isLocalhost(ctx)) {
		ctx.cookies.set(SESSION_COOKIE, null, { maxAge: 0 });
	}
}
