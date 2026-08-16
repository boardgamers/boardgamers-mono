/**
 * Bounded header values for the per-request log line (see hooks.server.ts), so
 * the maintainer can spot bot/scraper traffic in the Loki/Grafana stream, e.g.
 *   {job="pm2", source="web", msg="request"} | json | ua != ""
 * Same zero-hot-path pattern as Accept-Language (src/lib/accept-language.ts):
 * a plain header read attached to the log line that already flows to Loki.
 */

// Bounds log-line size against absurdly long client-supplied headers. 200 chars
// covers every mainstream browser/crawler UA (Chrome/Firefox/Safari ≈ 100–150,
// Googlebot ≈ 120) while keeping one log line well under Loki's per-line limit.
const MAX_LOG_HEADER_LENGTH = 200;

/**
 * Sanitize a raw header value (e.g. `headers.get("user-agent")`) for logging:
 * trimmed, truncated to a bounded length, null when absent/empty (the field is
 * then simply omitted from the log line). Control chars are stripped so a
 * crafted header can't forge extra lines/fields in the JSON log stream.
 */
export function logHeader(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed.replace(/[\r\n\t]/g, " ").slice(0, MAX_LOG_HEADER_LENGTH);
}
