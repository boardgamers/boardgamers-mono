import { api } from "$lib/api.ts";
import type { UserFront, GameFront, ApiErrorFront } from "@bgs/models";

export type RecentGame = Pick<GameFront, "_id" | "game" | "status" | "lastMove" | "createdAt">;

export type UserInfo = Pick<UserFront, "_id" | "account" | "security" | "authority" | "createdAt"> & {
	games?: Record<string, number>;
	recentGames?: RecentGame[];
};

export type ApiErrorItem = ApiErrorFront;

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
