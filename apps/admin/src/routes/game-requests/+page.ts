import { api } from "$lib/api.ts";
import { EMPTY_ME, type AdminMe } from "$lib/permissions.ts";

export interface AdminGameRequest {
	_id: string;
	label: string;
	description?: string;
	likeCount: number;
	requestedBy?: string;
	forumTid?: number;
	createdAt?: string;
}

export interface AdminGameEntry {
	_id: string;
	label: string;
	alias?: string;
}

export async function load(): Promise<{ requests: AdminGameRequest[]; games: AdminGameEntry[]; me: AdminMe }> {
	const [requests, games, me] = await Promise.all([
		api.get<AdminGameRequest[]>("/admin/feedback/game-requests").catch(() => []),
		// Existing game implementations, for the "merge into" select (status
		// "requested" docs are excluded server-side, so no overlap with requests).
		api.get<AdminGameEntry[]>("/admin/gameinfo").catch(() => []),
		api.get<AdminMe>("/admin/me").catch(() => EMPTY_ME),
	]);
	return { requests, games, me };
}
