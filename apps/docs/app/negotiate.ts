/** Weighted media-range match (RFC 7231 §5.3.2): 0 = no match. */
function matchQuality(range: string, type: string, subtype: string): number {
	const [rType, rSub] = range.split("/").map((s) => s.trim().toLowerCase());
	if (rType === "*" && (rSub === "*" || rSub === undefined)) return 1;
	if (rType === type && rSub === "*") return 2;
	if (rType === type && rSub === subtype) return 3;
	return 0;
}

/**
 * True when the client prefers markdown over HTML — either an explicit
 * `Accept: text/markdown` outranks text/html, or the header is absent/`*` only
 * (curl's default `Accept: *​/*` → markdown, the agent-friendly default).
 */
export function wantsMarkdown(acceptHeader: string | undefined): boolean {
	let md = 0;
	let html = 0;
	// No accept header at all (or an empty one) is the agent default — treat as */*.
	for (const part of (acceptHeader?.trim() ? acceptHeader : "*/*").split(",")) {
		const [range, ...params] = part.split(";");
		const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
		const q = qParam ? Number(qParam.slice(2)) : 1;
		if (!range.trim() || Number.isNaN(q) || q <= 0) continue;
		md = Math.max(md, matchQuality(range, "text", "markdown") * q);
		html = Math.max(html, matchQuality(range, "text", "html") * q);
	}
	return md > 0 && md >= html;
}
