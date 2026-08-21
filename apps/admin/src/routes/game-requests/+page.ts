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

export async function load(): Promise<{ requests: AdminGameRequest[]; me: AdminMe }> {
	const [requests, me] = await Promise.all([
		api.get<AdminGameRequest[]>("/admin/feedback/game-requests").catch(() => []),
		api.get<AdminMe>("/admin/me").catch(() => EMPTY_ME),
	]);
	return { requests, me };
}
