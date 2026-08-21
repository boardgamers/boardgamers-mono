import type { Context } from "koa";

/**
 * Language negotiation for CONTENT (CMS pages — issue #306), as opposed to the
 * site UI whose locales are a fixed build-time list. A content page is an
 * arbitrary DB row keyed `{_id: {name, lang}}` and can exist in ANY language,
 * so negotiation here is not restricted to a hardcoded supported set: any
 * well-formed 2–3 letter base subtag is accepted, and the requested-lang → "en"
 * fallback happens at lookup time (see routes/pages).
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
// "fr-ca"). Anything else (path traversal, `$gt:`-style operator injection,
// quoted junk) is treated as absent.
const LANG_SHAPE = /^[a-z]{2,3}(-[a-z0-9]+)?$/i;

/** The base subtag of a cookie/header language value, or null when unusable. */
function baseSubtag(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!LANG_SHAPE.test(trimmed)) {
		return null;
	}
	return trimmed.split("-")[0].toLowerCase();
}

/**
 * Resolve the visitor's preferred content language for this request. The
 * result is always a lowercase 2–3 letter base subtag, "en" when nothing
 * usable is present. Pure apart from reading the request's cookie/header.
 */
export function negotiateContentLanguage(ctx: Context): string {
	const cookieLang = baseSubtag(ctx.cookies.get("lang"));
	if (cookieLang) {
		return cookieLang;
	}

	// Accept-Language is comma-separated, most-preferred first (browsers order
	// by q): take the first entry and strip any ";q=…" parameter.
	const header = ctx.get("accept-language");
	const first = header.split(",")[0]?.split(";")[0];
	return baseSubtag(first) ?? "en";
}
