import type { RequestHandler } from "./$types";
import { loadBoardgameCard } from "@/lib/thumbnail-data.server";
import { shareImageEtag, shareImageResponse } from "@/lib/share-image.server";

// Boardgame share image: the card content (and thus the ETag) comes from the gameinfo
// doc — a new latest version changes the ETag and re-renders on revalidation.
export const GET: RequestHandler = async ({ params, url, request }) => {
	const { etagData } = await loadBoardgameCard(params.boardgameId);
	return shareImageResponse(
		url.origin,
		`/thumbnail/boardgame/${encodeURIComponent(params.boardgameId)}`,
		shareImageEtag(etagData),
		request.headers.get("if-none-match"),
	);
};
