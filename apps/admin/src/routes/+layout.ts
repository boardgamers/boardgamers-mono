import { api } from "$lib/api.ts";
import { EMPTY_ME, type AdminMe } from "$lib/permissions.ts";
import type { UserFront, PageFront } from "@bgs/models";

export const ssr = false;
export const prerender = false;

// One entry per boardgame (the admin gameinfo list dedupes versions server-side).
export interface BoardgameEntry {
	_id: string;
	label: string;
	alias?: string;
}

export interface LayoutData {
	user: (UserFront & { _id: string }) | null;
	me: AdminMe;
	games: BoardgameEntry[];
	pages: PageFront[];
}

export async function load(): Promise<LayoutData> {
	// Auth is the session cookie: /account 401s when logged out — no client-side token check.
	const [user, me, games, pages] = await Promise.all([
		api.get<UserFront & { _id: string }>("/account").catch(() => null),
		api.get<AdminMe>("/admin/me").catch(() => EMPTY_ME),
		api.get<BoardgameEntry[]>("/admin/gameinfo").catch(() => []),
		api.get<PageFront[]>("/admin/page").catch(() => []),
	]);

	return {
		user: user?._id ? user : null,
		me: me ?? EMPTY_ME,
		games: games ?? [],
		pages: pages ?? [],
	};
}
