import type { RequestHandler } from "./$types";
import { loadGameCard } from "@/lib/thumbnail-data.server";
import { shareImageEtag, shareImageResponse } from "@/lib/share-image.server";

// Game share image (open or started): the ETag is derived from exactly what the card
// shows — status, players joined, pace, round — so a join/leave/round-advance busts
// downstream caches on revalidation without re-screenshotting unchanged games.
export const GET: RequestHandler = async ({ params, url, request }) => {
	const { etagData } = await loadGameCard(params.gameId);
	return shareImageResponse(
		url.origin,
		`/thumbnail/game/${encodeURIComponent(params.gameId)}`,
		shareImageEtag(etagData),
		request.headers.get("if-none-match"),
	);
};
