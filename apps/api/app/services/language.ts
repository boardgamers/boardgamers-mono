import { regionalLocaleDefaults } from "@bgs/models";
import type { Context } from "koa";

/**
 * Language negotiation for CONTENT (CMS pages — issue #306), as opposed to the
 * site UI whose locales are a fixed build-time list. A content page is an
 * arbitrary DB row keyed `{_id: {name, lang}}` and can exist in ANY language,
 * so negotiation here is not restricted to a hardcoded supported set: any
 * well-formed language tag is accepted, and fallbacks happen at lookup time
 * (see routes/pages).
 *
 * Region subtags are preserved: a `pt-BR` visitor can be served a `pt-BR`
 * page. Fallback candidates are derived for regionally-localized languages —
 * a bare `pt` request also tries `pt-BR` (regionalLocaleDefaults, mirroring
 * apps/web's parseLanguageTag), and a `pt-BR` request also tries `pt`.
 *
 * Sources, in priority order:
 *  1. the `lang` cookie (an explicit visitor choice — set by the web app when
 *     the user picks a language),
 *  2. the FIRST (most-preferred) entry of the Accept-Language header
 *     (mirrors apps/web/src/lib/accept-language.ts parsePreferredLanguage),
 *  3. "en" as the default.
 */

// Strict shape for a value we'll interpolate into a Mongo query: a 2–3 letter
// base subtag, optionally followed by one region/script segment (e.g. "de",
// "pt-BR", "fr-ca"). Anything else (path traversal, `$gt:`-style operator
// injection, quoted junk) is treated as absent.
const LANG_SHAPE = /^[a-z]{2,3}(-[a-z0-9]+)?$/i;

/**
 * Canonical form of a cookie/header language value — lowercase base subtag,
 * uppercase region ("PT-br" → "pt-BR", matching the locale codes' conventional
 * casing) — or null when unusable.
 */
function languageTag(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!LANG_SHAPE.test(trimmed)) {
		return null;
	}
	return trimmed
		.split("-")
		.map((part, i) => (i === 0 ? part.toLowerCase() : part.toUpperCase()))
		.join("-");
}

/**
 * Resolve the visitor's preferred content language for this request. The
 * result is a canonical language tag ("en", "pt-BR"), "en" when nothing
 * usable is present. Pure apart from reading the request's cookie/header.
 */
export function negotiateContentLanguage(ctx: Context): string {
	const cookieLang = languageTag(ctx.cookies.get("lang"));
	if (cookieLang) {
		return cookieLang;
	}

	// Accept-Language is comma-separated, most-preferred first (browsers order
	// by q): take the first entry and strip any ";q=…" parameter.
	const header = ctx.get("accept-language");
	const first = header.split(",")[0]?.split(";")[0];
	return languageTag(first) ?? "en";
}

/**
 * Lookup candidates for a negotiated content language, most-preferred first,
 * ending in "en" (the final fallback, deduped): "pt" → ["pt", "pt-BR", "en"],
 * "pt-BR" → ["pt-BR", "pt", "en"], "de" → ["de", "en"].
 */
export function contentLanguageCandidates(lang: string): string[] {
	const candidates = [lang];
	const base = lang.split("-")[0];
	if (base !== lang) {
		candidates.push(base);
	} else {
		const regional = regionalLocaleDefaults[base.toLowerCase()];
		if (regional && regional !== lang) {
			candidates.push(regional);
		}
	}
	if (!candidates.includes("en")) {
		candidates.push("en");
	}
	return candidates;
}
