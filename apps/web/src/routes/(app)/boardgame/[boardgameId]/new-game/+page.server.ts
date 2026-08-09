import type { PageServerLoad } from "./$types";
import { getGameInfo } from "@/lib/game-info.svelte";
import { stripMarkdown, truncate } from "@/lib/seo";
import { gameLabel } from "@/utils/game-label";

// Read the per-boardgame "remember my last setup" cookie server-side so the new-game
// form can render the saved options during SSR (avoiding a defaults→saved flash on hydration).
export const load: PageServerLoad = async ({ params, request }) => {
	const cookieHeader = request.headers.get("cookie") ?? "";
	const name = `new-game-setup:${params.boardgameId}`;
	const raw = cookieHeader
		.split(";")
		.map((x) => x.trim())
		.find((x) => x.startsWith(`${name}=`))
		?.slice(name.length + 1);

	let lastSetup: Record<string, unknown> | null = null;
	if (raw) {
		try {
			lastSetup = JSON.parse(decodeURIComponent(raw));
		} catch {
			lastSetup = null;
		}
	}

	// `parent()` in a server load only sees server layouts, not the boardgame layout's
	// client-side load — fetch the game-info doc directly (SSR-safe, request-scoped).
	const gameInfo = await getGameInfo(params.boardgameId, "latest");
	const label = gameLabel(gameInfo?.label ?? params.boardgameId);

	return {
		lastSetup,
		seo: {
			title: `Create a ${label} game`,
			description: truncate(stripMarkdown(gameInfo?.description ?? ""), 200),
		},
	};
};
