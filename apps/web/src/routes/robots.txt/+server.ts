import type { RequestHandler } from "./$types";

// Public pages are all crawlable; keep crawlers out of session flows, user-private
// areas and backend-ish endpoints. /game/ URLs are live sessions (iframe + JS), of no
// value to index — the lobby/boardgame pages carry the indexable content.
const disallowed = [
	"/account",
	"/admin",
	"/api",
	"/auth",
	"/confirm",
	"/forgotten-password",
	"/game/",
	"/next-game",
	"/og",
	"/reset",
	"/ws",
];

export const GET: RequestHandler = ({ url }) => {
	const body = [
		"User-agent: *",
		"Allow: /",
		...disallowed.map((path) => `Disallow: ${path}`),
		"",
		`Sitemap: ${url.origin}/sitemap.xml`,
		"",
	].join("\n");

	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=86400",
		},
	});
};
