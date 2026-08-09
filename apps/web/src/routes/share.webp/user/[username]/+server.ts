import type { RequestHandler } from "./$types";
import { loadUserCard } from "@/lib/thumbnail-data.server";
import { shareImageEtag, shareImageResponse } from "@/lib/share-image.server";

// User share image: card content (and ETag) comes from the public user doc — username,
// bio, karma. A karma/bio change re-renders on revalidation; nothing else does.
export const GET: RequestHandler = async ({ params, url, request }) => {
	const { etagData } = await loadUserCard(params.username);
	return shareImageResponse(
		url.origin,
		`/thumbnail/user/${encodeURIComponent(params.username)}`,
		shareImageEtag(etagData),
		request.headers.get("if-none-match"),
	);
};
