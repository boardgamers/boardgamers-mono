import removeMarkdown from "remove-markdown";

export const siteName = "Boardgamers";

export const defaultDescription =
	"Play Gaia Project, 6nimmt, Powergrid and Container online. All games and the platform are open source!";

// Rendered at request time by /share.png/* (route-driven; card text comes from the db,
// never the query string, so share images can't be abused to host arbitrary text).
export const defaultOgImage = { path: "/share.png", width: 1200, height: 630 };

export function absoluteUrl(origin: string, pathOrUrl: string): string {
	return pathOrUrl.startsWith("http") ? pathOrUrl : `${origin}${pathOrUrl}`;
}

export function stripMarkdown(markdown: string): string {
	return removeMarkdown(markdown).replace(/\s+/g, " ").trim();
}

// First sentence of a (possibly markdown) text, for OG card sub-text.
export function firstSentence(text: string, max = 140): string {
	const clean = stripMarkdown(text);
	if (!clean) {
		return "";
	}
	const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
	return truncate(match?.[1] ?? clean, max);
}

export function truncate(text: string, max: number): string {
	return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

export type ShareImageTarget =
	| { kind: "home" }
	| { kind: "boardgame"; id: string }
	| { kind: "game"; id: string }
	| { kind: "user"; id: string };

/**
 * Route-based OG share-image URL. The card content is derived server-side from the
 * entity in the db (see /thumbnail/* and /share.png/*), so callers only name the entity —
 * they can't inject arbitrary text into a branded thumbnail.
 */
export function shareImageUrl(target: ShareImageTarget): string {
	switch (target.kind) {
		case "home":
			return defaultOgImage.path;
		case "boardgame":
			return `${defaultOgImage.path}/boardgame/${encodeURIComponent(target.id)}`;
		case "game":
			return `${defaultOgImage.path}/game/${encodeURIComponent(target.id)}`;
		case "user":
			return `${defaultOgImage.path}/user/${encodeURIComponent(target.id)}`;
	}
}
