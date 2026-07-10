import { api } from "$lib/api.ts";

export interface RecentGame {
	_id: string;
	game: { name: string };
	status: string;
	lastMove: string;
	createdAt: string;
}

export interface UserInfo {
	_id: string;
	account: { username: string; email: string; karma: number };
	security?: {
		lastIp?: string;
		confirmed?: boolean;
		lastLogin?: { ip: string; date: string };
		lastActive?: string;
		lastOnline?: string;
	};
	authority?: string;
	createdAt: string;
	games?: Record<string, number>;
	recentGames?: RecentGame[];
}

export interface ApiErrorItem {
	_id: string;
	error: { name: string; message: string };
	request: { url: string; method: string };
	createdAt: string;
	[key: string]: unknown;
}

export async function load({ params }: { params: { username: string } }): Promise<{
	user: UserInfo | null;
	errors: ApiErrorItem[];
}> {
	try {
		const user = await api.get<UserInfo>(`/admin/users/infoByName/${params.username}`);
		const errors = await api.get<ApiErrorItem[]>(`/admin/users/${user._id}/api-errors`);
		return { user, errors };
	} catch {
		return { user: null, errors: [] };
	}
}
