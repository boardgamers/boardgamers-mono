import type { Context } from "koa";
import net from "node:net";
import { z } from "zod";
import { logEvent } from "@bgs/utils/log";
import { env } from "../config/index.ts";
import { colls } from "../config/db.ts";

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

/**
 * Prod is HTTPS-only, so the session cookie must stay `Secure` — but prod logs a
 * chronic "Cannot send secure cookie over unencrypted connection" (~25–56/day +
 * bursts), meaning some requests reach the api with `ctx.secure === false`
 * (bypassing the https vhost, or X-Forwarded-Proto dropped/mangled somewhere).
 * We do NOT know the source yet, and a prior "just drop Secure on http" fix was
 * rejected (it would weaken the cookie for an https site). This captures the full
 * request context — one structured log line (greppable as
 * `secure-cookie-over-insecure`) + one `apierrors` record (meta.source =
 * "secure-cookie", visible on the admin health page) — so the culprit can be
 * identified and the real root cause fixed.
 */
export function recordSecureCookieDiagnostic(ctx: Context, trigger: "sliding-session" | "login"): void {
	// Fields degrade gracefully: tests call setRefreshCookie with partial ctx stubs
	// (auth.spec.ts's social-flow stub has no get/ips/app), and a diagnostic must
	// never break the request it observes. ctx.get returns "" for absent headers;
	// filter those so the log line and db record omit them instead of storing "".
	const header = (name: string): string | undefined =>
		typeof ctx.get === "function" ? ctx.get(name) || undefined : undefined;
	const context = {
		secure: !!ctx.secure,
		protocol: ctx.protocol ?? "",
		hostname: ctx.hostname ?? "",
		ip: ctx.ip ?? "",
		ips: ctx.ips ?? [],
		method: ctx.method ?? "",
		url: ctx.originalUrl ?? "",
		path: ctx.path ?? "",
		headers: Object.fromEntries(
			(["x-forwarded-proto", "x-forwarded-host", "host", "user-agent", "referer", "origin"] as const)
				.map((name) => [name, header(name)] as const)
				.filter((entry): entry is [(typeof entry)[0], string] => !!entry[1]),
		),
		proxy: !!ctx.app?.proxy,
	};
	logEvent("warn", "secure-cookie-over-insecure", {
		source: "api",
		trigger,
		requestId: ctx.state.requestId,
		...context,
	});
	colls.apiErrors
		.insertOne({
			error: {
				name: "SecureCookieOverInsecure",
				message: "Setting a Secure session cookie on an insecure request",
				stack: [],
			},
			request: {
				url: context.url,
				method: context.method,
				body: "",
				id: ctx.state.requestId,
				path: context.path,
				protocol: context.protocol,
				hostname: context.hostname,
				secure: context.secure,
				ip: context.ip,
				ips: context.ips,
				headers: context.headers,
			},
			user: ctx.state.user?._id,
			meta: { source: "secure-cookie", userAgent: context.headers["user-agent"], proxy: context.proxy },
			createdAt: new Date(),
		})
		.catch((err) => logEvent("error", "secure-cookie-diagnostic-failed", { source: "api", error: String(err) }));
}

/** Set the session cookie (JSON { code, expiresAt }), sliding the expiry forward. */
export function setRefreshCookie(ctx: Context, code: string, trigger: "sliding-session" | "login" = "login") {
	const expiresAt = Date.now() + refreshTokenDuration();
	const value = JSON.stringify({ code, expiresAt });
	const local = isLocalhost(ctx);
	if (!local && !ctx.secure) {
		recordSecureCookieDiagnostic(ctx, trigger);
	}
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
		domain: local ? undefined : env.domain,
	});
}

/** Clear the session cookie (logout) — same `domain` it was set with, or it won't be removed. */
export function clearRefreshCookie(ctx: Context) {
	ctx.cookies.set(SESSION_COOKIE, null, { maxAge: 0, domain: isLocalhost(ctx) ? undefined : env.domain });
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
