import { api } from "$lib/api.ts";
import { tokens } from "$lib/auth.svelte.ts";
import type { UserFront, GameInfoFront, PageFront } from "@bgs/models";

export const ssr = false;
export const prerender = false;

export interface LayoutData {
	user: (UserFront & { _id: string }) | null;
	games: GameInfoFront[];
	pages: PageFront[];
}

export async function load(): Promise<LayoutData> {
	if (!tokens.refresh) {
		return { user: null, games: [], pages: [] };
	}

	const [user, games, pages] = await Promise.all([
		api.get<UserFront & { _id: string }>("/account").catch(() => null),
		api.get<GameInfoFront[]>("/admin/gameinfo").catch(() => []),
		api.get<PageFront[]>("/admin/page").catch(() => []),
	]);

	return {
		user: user?._id ? user : null,
		games: games ?? [],
		pages: pages ?? [],
	};
}
