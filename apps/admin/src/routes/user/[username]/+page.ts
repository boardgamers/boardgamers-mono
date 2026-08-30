import { api } from "$lib/api.ts";
import type { UserFront, GameFront, ApiErrorFront } from "@bgs/models";

export type RecentGame = Pick<GameFront, "_id" | "game" | "status" | "lastMove" | "createdAt">;

export type UserInfo = Pick<
	UserFront,
	"_id" | "account" | "security" | "authority" | "adminGrants" | "createdAt" | "chatMutedUntil"
> & {
	games?: Record<string, number>;
	recentGames?: RecentGame[];
};

// Answer shape when the username resolves to an archived (soft-deleted) account
// instead of an active one.
export type ArchivedUserInfo = {
	archived: true;
	userId: string;
	account: { username: string };
	createdAt?: string;
	deletedAt: string;
};

export type ApiErrorItem = ApiErrorFront;

// One private-beta grant: access to the game's versions up to maxVersion.
export type BetaAccess = {
	game: string;
	label: string;
	maxVersion: number;
};

export async function load({ params }: { params: { username: string } }): Promise<{
	user: UserInfo | null;
	archived: ArchivedUserInfo | null;
	errors: ApiErrorItem[];
	betas: BetaAccess[];
}> {
	try {
		const user = await api.get<UserInfo | ArchivedUserInfo>(`/admin/users/infoByName/${params.username}`);
		if ("archived" in user && user.archived) {
			return { user: null, archived: user, errors: [], betas: [] };
		}
		const [errors, betas] = await Promise.all([
			api.get<ApiErrorItem[]>(`/admin/users/${(user as UserInfo)._id}/api-errors`),
			api.get<BetaAccess[]>(`/admin/users/${(user as UserInfo)._id}/access`),
		]);
		return { user: user as UserInfo, archived: null, errors, betas };
	} catch {
		return { user: null, archived: null, errors: [], betas: [] };
	}
}
