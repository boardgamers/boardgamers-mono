import removeMarkdown from "remove-markdown";

export const siteName = "Boardgamers";

export const defaultDescription =
	"Play Gaia Project, 6nimmt, Powergrid and Container online. All games and the platform are open source!";

// Rendered at request time by /og/share.png — kept in sync with its +server.ts.
export const defaultOgImage = { path: "/og/share.png", width: 1200, height: 630 };

export function absoluteUrl(origin: string, pathOrUrl: string): string {
	return pathOrUrl.startsWith("http") ? pathOrUrl : `${origin}${pathOrUrl}`;
}

export function stripMarkdown(markdown: string): string {
	return removeMarkdown(markdown).replace(/\s+/g, " ").trim();
}

export function truncate(text: string, max: number): string {
	return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

export interface OgCardParams {
	title?: string;
	subtitle?: string;
	/** Game label (e.g. "Gaia Project") — the card shows a monogram badge derived from it. */
	game?: string;
	players?: string;
	pace?: string;
}

export function ogImageUrl(pathOrUrl: string, opts?: OgCardParams): string {
	if (pathOrUrl.startsWith("http") || !opts?.title) {
		return pathOrUrl;
	}
	const params = new URLSearchParams({ title: opts.title.slice(0, 90) });
	if (opts.subtitle) {
		params.set("subtitle", opts.subtitle.slice(0, 140));
	}
	if (opts.game) {
		params.set("game", opts.game.slice(0, 60));
	}
	if (opts.players) {
		params.set("players", opts.players.slice(0, 40));
	}
	if (opts.pace) {
		params.set("pace", opts.pace.slice(0, 40));
	}
	return `${pathOrUrl}?${params}`;
}
