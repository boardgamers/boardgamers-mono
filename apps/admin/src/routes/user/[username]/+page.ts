import { api } from "$lib/api.ts";

export interface UserInfo {
	_id: string;
	account: { username: string; email: string; karma: number };
	security?: { lastIp?: string; confirmed?: boolean };
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
