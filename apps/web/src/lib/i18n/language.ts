import { browser } from "$app/environment";
import { parsePreferredLanguage, parsePreferredLanguageTag } from "@/lib/accept-language";
import { defaultLocale, isLocale, regionalLocaleDefaults, type Locale } from "./locales";

/**
 * The viewer's UI language, threaded from the request to the renderers —
 * mirrors the `tz` cookie pattern (src/lib/timezone.ts, #339).
 *
 * Resolution priority (see resolveLanguage):
 *   1. logged-in user's `settings.language` (applied in the root layout server
 *      load, which is the first place the user is known — hooks only have cookies)
 *   2. `lang` cookie (stamped by the client on every switch, setLanguageCookie)
 *   3. `Accept-Language` header (exact tag, then base subtag, matched against
 *      the supported list: "pt-BR" → pt-BR, "de-AT" → de; a bare base subtag
 *      only supported regionally falls back to its regional default, "pt" →
 *      pt-BR; unsupported values fall through)
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

/**
 * Like parseLanguage, but tolerant of case and region subtags (BCP-47 tags
 * are case-insensitive; our locale codes use the conventional casing, e.g.
 * "pt-BR"): an exact unsupported tag retries on its base subtag, so "pt-br"
 * and "pt-BR" both resolve to the "pt-BR" locale while "de-AT" → "de". A bare
 * base subtag only supported regionally falls back to its regional default
 * ("pt" → "pt-BR", see regionalLocaleDefaults).
 */
export function parseLanguageTag(value: unknown): Locale | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const exact = parseLanguage(value);
	if (exact) {
		return exact;
	}
	const canonical = value
		.split("-")
		.map((part, i) => (i === 0 ? part.toLowerCase() : part.toUpperCase()))
		.join("-");
	if (canonical !== value) {
		const cased = parseLanguage(canonical);
		if (cased) {
			return cased;
		}
	}
	const base = value.split("-")[0];
	if (base !== value) {
		const stripped = parseLanguage(base);
		if (stripped) {
			return stripped;
		}
	}
	return regionalLocaleDefaults[base.toLowerCase()];
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
	return parseLanguageTag(value);
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
		parseLanguageTag(input.userPreference) ??
		languageFromCookieHeader(input.cookieHeader ?? "") ??
		// Regionally-localized languages keep their region subtag (pt-BR); the
		// bare base subtag ("pt") then falls back to the regional default.
		parseLanguageTag(parsePreferredLanguageTag(input.acceptLanguageHeader)) ??
		parseLanguageTag(parsePreferredLanguage(input.acceptLanguageHeader)) ??
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
