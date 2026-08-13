import type { GameInfoFront } from "@bgs/models";
import { gameDisplayName } from "@/utils/game-label";
import { shareImageUrl, stripMarkdown, truncate, type SeoData } from "@/lib/seo";

// The SERP sweet spot for a description; the lead below stays readable within it.
const DESCRIPTION_MAX = 160;

/**
 * OG/head meta for a boardgame landing page (/boardgame/<id>). The title and the
 * description lead carry the "Play <name> online" signal so the page ranks for
 * "play <game> online" searches (BGA's titles follow the same pattern).
 */
export function boardgameSeo(boardgameId: string, gameInfo: GameInfoFront | null | undefined): SeoData {
	const name = gameInfo ? gameDisplayName(gameInfo, { emoji: false }) : boardgameId;
	const lead = `Play ${name} online with other people, live or asynchronously.`;
	const blurb = stripMarkdown(gameInfo?.description ?? "");
	return {
		title: `Play ${name} online`,
		description: truncate(blurb ? `${lead} ${blurb}` : lead, DESCRIPTION_MAX),
		image: shareImageUrl({ kind: "boardgame", id: boardgameId }),
	};
}
