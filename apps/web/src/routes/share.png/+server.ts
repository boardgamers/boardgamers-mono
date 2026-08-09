import type { RequestHandler } from "./$types";
import { loadHomeCard } from "@/lib/thumbnail-data.server";
import { shareImageEtag, shareImageResponse } from "@/lib/share-image.server";

// Home share image. Card text is fixed site copy — no input accepted, so the ETag is
// stable until the tagline text itself changes in a deploy.
export const GET: RequestHandler = async ({ url, request }) => {
	const { etagData } = await loadHomeCard();
	return shareImageResponse(url.origin, "/thumbnail", shareImageEtag(etagData), request.headers.get("if-none-match"));
};
