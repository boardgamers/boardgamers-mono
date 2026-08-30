import type { PageServerLoad } from "./$types";
import { getGameInfo } from "@/lib/game-info.svelte";
import { stripMarkdown, truncate } from "@/lib/seo";
import { gameDisplayName } from "@/utils/game-label";

// Read the per-boardgame "remember my last setup" cookie server-side so the new-game
// form can render the saved options during SSR (avoiding a defaults→saved flash on hydration).
export const load: PageServerLoad = async ({ params, request }) => {
	const cookieHeader = request.headers.get("cookie") ?? "";
	const readJsonCookie = (name: string): Record<string, unknown> | null => {
		const raw = cookieHeader
			.split(";")
			.map((x) => x.trim())
			.find((x) => x.startsWith(`${name}=`))
			?.slice(name.length + 1);
		if (!raw) return null;
		try {
			return JSON.parse(decodeURIComponent(raw));
		} catch {
			return null;
		}
	};

	const lastSetup = readJsonCookie(`new-game-setup:${params.boardgameId}`);
	// Timing used on the last created game, across all boardgames (#377).
	const lastTiming = readJsonCookie("new-game-timing");

	// `parent()` in a server load only sees server layouts, not the boardgame layout's
	// client-side load — fetch the game-info doc directly (SSR-safe, request-scoped).
	const gameInfo = await getGameInfo(params.boardgameId, "latest");
	const label = gameInfo ? gameDisplayName(gameInfo, { emoji: false }) : params.boardgameId;

	return {
		lastSetup,
		lastTiming,
		seo: {
			title: `Create a ${label} game`,
			description: truncate(stripMarkdown(gameInfo?.description ?? ""), 200),
		},
	};
};
