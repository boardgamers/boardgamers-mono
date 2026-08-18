import { browser } from "$app/environment";
import { getContext, setContext } from "svelte";

/**
 * The viewer's IANA timezone, threaded from the request to the time-of-day
 * renderers (timerTimeInTz / timerWindowInTz / timezoneName).
 *
 * The browser can't send its timezone in a request header by itself, so the
 * client stamps it into a `tz` cookie on load (initTimezoneCookie, called from
 * the root layout load). The SSR hooks read that cookie into locals.timezone,
 * the root layout provides it via context, and the time helpers render with it
 * — so SSR HTML and client hydration agree and there's no hydration mismatch
 * for return visitors. The very first visit has no cookie yet: SSR falls back
 * to UTC and the client re-renders with the real zone on hydration (accepted
 * per #339 — first paint may be inaccurate, subsequent ones are exact). The
 * cookie is refreshed on every load, so a timezone change (travel) fixes
 * itself on the next render.
 *
 * A cookie was chosen over a custom request header on API calls: the cookie
 * rides same-origin requests with zero CORS surface (a custom header would
 * trigger a preflight in any cross-origin deployment), and it's already set by
 * the time the first API call fires.
 */

const TZ_COOKIE = "tz";
const TZ_CONTEXT_KEY = "viewer-timezone";

// Loose IANA shape ("Europe/Paris", "America/New_York", "UTC", "Etc/GMT+5").
// Validity is decided by Intl below; this just rejects cookie junk before it
// reaches Intl (the cookie is attacker-controllable).
const TZ_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]{0,30}(\/[A-Za-z0-9_+-]{1,30}){0,2}$/;

/** The validated timezone, or undefined when missing/invalid. */
export function parseTimezone(tz: unknown): string | undefined {
	if (typeof tz !== "string" || !TZ_SHAPE.test(tz)) {
		return undefined;
	}
	try {
		new Intl.DateTimeFormat("en", { timeZone: tz });
		return tz;
	} catch {
		return undefined;
	}
}

/** Extract the viewer timezone from a raw Cookie header value (SSR hooks). */
export function timezoneFromCookieHeader(cookieHeader: string): string | undefined {
	const pair = cookieHeader
		.split(";")
		.map((x) => x.trim())
		.find((x) => x.startsWith(`${TZ_COOKIE}=`));
	if (!pair) {
		return undefined;
	}
	let value: string;
	try {
		value = decodeURIComponent(pair.slice(TZ_COOKIE.length + 1));
	} catch {
		return undefined;
	}
	return parseTimezone(value);
}

/** Stamp the browser's timezone into the `tz` cookie (idempotent). Client-only. */
export function initTimezoneCookie(): void {
	if (!browser) {
		return;
	}
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (!tz) {
		return;
	}
	// Deliberately not HttpOnly: this function must be able to refresh it.
	// SameSite=Lax is enough — it only ever travels to our own origin.
	document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
}

/**
 * Provide the request's timezone to the component tree (root layout, both
 * SSR and client). `tz` must already be validated/normalized.
 */
export function provideTimezone(tz: string): void {
	setContext(TZ_CONTEXT_KEY, tz);
}

/**
 * The viewer's timezone for time-of-day rendering: the per-request cookie value
 * on the server, the browser's zone on the client. Call during component init
 * (getContext is init-only). Falls back to the context value outside a
 * component, then to the runtime zone / "UTC".
 */
export function viewerTimezone(): string {
	const fromContext = getContext<string | undefined>(TZ_CONTEXT_KEY);
	if (fromContext) {
		return fromContext;
	}
	if (browser) {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	}
	return "UTC";
}
