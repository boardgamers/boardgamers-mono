import { api } from "$lib/api.ts";
import type { GameInfoFront } from "@bgs/models";

export async function load({ params }: { params: { game: string; version: string } }): Promise<{
	value: GameInfoFront | null;
}> {
	try {
		const value = await api.get<GameInfoFront>(`/admin/gameinfo/${params.game}/${params.version}`);
		return { value };
	} catch {
		return { value: null };
	}
}
