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
	// Try the raw value first: a valid JSON containing a literal `%` (e.g. in the
	// refresh code) would throw in decodeURIComponent and be wrongly rejected.
	// Fall back to decode+parse for percent-encoded values — ctx.cookies.get decodes
	// only leniently, so values with cookie-invalid characters come back still encoded.
	try {
		return refreshCookieSchema.parse(JSON.parse(raw)).code;
	} catch {
		try {
			return refreshCookieSchema.parse(JSON.parse(decodeURIComponent(raw))).code;
		} catch {
			return null;
		}
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
		// Lax (not Strict): the OAuth callback sets this cookie mid-redirect-chain from
		// the provider's origin, and browsers treat the follow-up navigation to /account
		// as cross-site-initiated — Strict withholds the cookie on that first same-site
		// hop, so the SSR sees an anonymous user and bounces to /login. Lax still blocks
		// cross-site subrequests (fetch/XHR/iframe), only top-level navigations are allowed.
		sameSite: "lax",
		// Host-only (no Domain): apex boardgamers.space is the canonical host (#153), so
		// the cookie must never be sent to forum./admin./resources./grafana. subdomains.
	});
	// A host-only cookie sorts BEFORE a Domain= one in the Cookie header, so a stale
	// legacy Domain=boardgamers.space cookie (set pre-cutover) would linger and shadow
	// the fresh one. Clear it (a deletion must repeat the exact Domain it was set
	// with, or the browser ignores it). Local never set a Domain cookie — skip there.
	// TODO(#153, #283): remove the Domain-cookie cleanup 120 days after deploy
	// (~2026-12-11) — by then every legacy Domain cookie (max 120-day lifetime) has expired.
	if (!local) {
		ctx.cookies.set(SESSION_COOKIE, null, { maxAge: 0, domain: env.domain });
	}
}

/**
 * Clear the session cookie (logout): the current host-only one AND the legacy
 * `Domain=env.domain` one set pre-cutover (#153) — both, so logout fully logs out
 * whichever variant the browser holds. A deletion must repeat the exact Domain the
 * cookie was set with, or the browser ignores it. Local never set a Domain cookie.
 */
export function clearRefreshCookie(ctx: Context) {
	ctx.cookies.set(SESSION_COOKIE, null, { maxAge: 0 });
	if (!isLocalhost(ctx)) {
		ctx.cookies.set(SESSION_COOKIE, null, { maxAge: 0, domain: env.domain });
	}
}

/**
 * Clear every variant of the session cookie: the current host-only one AND the legacy
 * `Domain=boardgamers.space` one set pre-cutover (#153) — same pair as
 * `clearRefreshCookie`, since a stale Domain= cookie would otherwise linger and
 * shadow the host-only one (it sorts first in the Cookie header).
 *
 * TODO(#153, #283): reduce back to the plain host-only clear 120 days after deploy
 * (~2026-12-11) — by then every legacy Domain cookie (max 120-day lifetime) has expired.
 */
export function clearAllRefreshCookieVariants(ctx: Context) {
	clearRefreshCookie(ctx);
}
