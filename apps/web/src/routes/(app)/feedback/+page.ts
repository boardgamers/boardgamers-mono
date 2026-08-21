import { get, toKitError } from "@/lib/api";
import type { FeedbackRequestFront } from "@bgs/models";
import type { PageLoad } from "./$types";

// A requested game (#340): a `gameMetadatas` doc with status "requested" (no
// version yet) or "beta" (an implementation exists but is not publicly released
// yet — it stays on the requests page until then). Voted on with the regular
// gamelike mechanic.
export type RequestedGame = {
	_id: string;
	label: string;
	description?: string;
	status?: "requested" | "beta";
	likeCount: number;
	liked: boolean;
	requestedBy?: string;
	forumTid?: number;
	createdAt?: string;
};

// The API serializes feedback requests with `liked` (per current user, false when
// anonymous) and `requestedBy` resolved to a username — neither is on the doc type.
export type FeedbackRequestListing = Omit<FeedbackRequestFront, "requestedBy"> & {
	liked: boolean;
	requestedBy?: string;
};

export const load: PageLoad = async () => {
	const [gameRequests, siteRequests] = await Promise.all([
		get<RequestedGame[]>("/boardgame/requests").catch(toKitError),
		get<FeedbackRequestListing[]>("/feedback", { kind: "site" }).catch(toKitError),
	]);

	return {
		gameRequests,
		siteRequests,
		seo: {
			title: "Feedback & Requests — Boardgamers",
			description:
				"Request new games and suggest site features on Boardgamers — vote with your meeple for the requests you want to see happen.",
			type: "article",
		},
	};
};
