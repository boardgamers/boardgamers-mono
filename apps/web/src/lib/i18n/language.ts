import { browser } from "$app/environment";
import { parsePreferredLanguage } from "@/lib/accept-language";
import { defaultLocale, isLocale, type Locale } from "./locales";

/**
 * The viewer's UI language, threaded from the request to the renderers —
 * mirrors the `tz` cookie pattern (src/lib/timezone.ts, #339).
 *
 * Resolution priority (see resolveLanguage):
 *   1. logged-in user's `settings.language` (applied in the root layout server
 *      load, which is the first place the user is known — hooks only have cookies)
 *   2. `lang` cookie (stamped by the client on every switch, setLanguageCookie)
 *   3. `Accept-Language` header (base subtag matched against the supported list:
 *      "de-AT" → de; unsupported values fall through)
 *   4. "en" (defaultLocale)
 *
 * The SSR hooks read cookie+Accept-Language into `locals.language`; the root
 * layout server load overrides with the user preference when present, and the
 * client re-stamps the `lang` cookie to match a preference override so the
 * next anonymous-session SSR agrees.
 */

export const LANGUAGE_COOKIE = "lang";

/** The validated locale, or undefined when missing/unsupported. */
export function parseLanguage(value: unknown): Locale | undefined {
	return isLocale(value) ? value : undefined;
}

/** Extract the UI language from a raw Cookie header value (SSR hooks). */
export function languageFromCookieHeader(cookieHeader: string): Locale | undefined {
	const pair = cookieHeader
		.split(";")
		.map((x) => x.trim())
		.find((x) => x.startsWith(`${LANGUAGE_COOKIE}=`));
	if (!pair) {
		return undefined;
	}
	let value: string;
	try {
		value = decodeURIComponent(pair.slice(LANGUAGE_COOKIE.length + 1));
	} catch {
		return undefined;
	}
	return parseLanguage(value);
}

/**
 * Resolve the request's UI language from the layers the hooks have access to
 * (cookie → Accept-Language → default). The user-preference layer is applied
 * later by the root layout server load (it needs the /account roundtrip).
 */
export function resolveLanguage(input: {
	cookieHeader?: string | null;
	acceptLanguageHeader?: string | null;
	userPreference?: unknown;
}): Locale {
	return (
		parseLanguage(input.userPreference) ??
		languageFromCookieHeader(input.cookieHeader ?? "") ??
		parseLanguage(parsePreferredLanguage(input.acceptLanguageHeader)) ??
		defaultLocale
	);
}

/** Stamp the chosen language into the `lang` cookie (idempotent). Client-only. */
export function setLanguageCookie(locale: Locale): void {
	if (!browser) {
		return;
	}
	// Deliberately not HttpOnly: this function must be able to refresh it.
	// SameSite=Lax is enough — it only ever travels to our own origin.
	document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
}
