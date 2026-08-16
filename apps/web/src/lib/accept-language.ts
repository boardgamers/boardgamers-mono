/**
 * Accept-Language analytics: which languages visitors prefer, to prioritize a
 * future i18n effort ("if I do multilanguage, which languages do I need to add").
 *
 * The parsed primary language is attached to the web app's existing per-request
 * log line (see hooks.server.ts), which already flows to Loki via promtail — so
 * this costs nothing on the hot path (it's just logging) and needs no DB writes.
 * The week-window breakdown is then a LogQL/Grafana query over that field, e.g.
 *   sum by (lang) (count_over_time({job="pm2", source="web", msg="request"} | json [7d]))
 */

/**
 * Extract the preferred language's BASE subtag from an Accept-Language header:
 * "fr-FR,fr;q=0.9,en;q=0.8" → "fr". Only the first (most-preferred) entry is
 * used — the goal is "each visitor's top language", not every listed language.
 * Returns null when nothing countable is present (missing header, wildcard,
 * malformed entries) — the request then simply carries no `lang` field.
 */
export function parsePreferredLanguage(header: string | null | undefined): string | null {
	if (!header) {
		return null;
	}
	// The header is comma-separated, most-preferred first (browsers order by q).
	// Take the first entry and strip any ";q=…" parameter.
	const first = header.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
	if (!first || first === "*") {
		return null;
	}
	// Keep only the base subtag: "fr-fr" → "fr", "zh-hant-tw" → "zh". Valid base
	// subtags are 2–3 ASCII letters (ISO 639); anything else is not countable.
	const base = first.split("-")[0];
	return /^[a-z]{2,3}$/.test(base) ? base : null;
}
