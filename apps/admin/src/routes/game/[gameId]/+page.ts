import { api } from "$lib/api.ts";
import type { ApiErrorFront, ChatMessageFront, GameFront, LogFront } from "@bgs/models";

export interface AdminGameInfo {
	game: Omit<GameFront, "data">;
	usernames: Record<string, string>;
	chat: ChatMessageFront[];
	errors: ApiErrorFront[];
	logs: LogFront[];
}

export async function load({ params }: { params: { gameId: string } }): Promise<{ info: AdminGameInfo | null }> {
	try {
		const info = await api.get<AdminGameInfo>(`/admin/games/${encodeURIComponent(params.gameId)}`);
		return { info };
	} catch {
		return { info: null };
	}
}
