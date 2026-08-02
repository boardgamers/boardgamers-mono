import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async () => {
	// Game infos come from the root layout's `gameInfos` data (fetched fresh per request).
	return {};
};
