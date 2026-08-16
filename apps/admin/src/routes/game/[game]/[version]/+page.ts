import { api } from "$lib/api.ts";
import type { GameInfoFront, GameMetadataDoc } from "@bgs/models";

export interface VersionTab {
	version: number;
	archived: boolean;
}

export async function load({ params }: { params: { game: string; version: string } }): Promise<{
	value: GameInfoFront | null;
	metadata: GameMetadataDoc | null;
	versions: VersionTab[];
}> {
	const [value, metadata, listed] = await Promise.all([
		api.get<GameInfoFront>(`/admin/gameinfo/${params.game}/${params.version}`).catch(() => null),
		api.get<GameMetadataDoc>(`/admin/gameinfo/${encodeURIComponent(params.game)}/meta`).catch(() => null),
		// One entry per version (sorted game asc, version desc) — pick this game's versions.
		api
			.get<Array<{ _id: { game: string; version: number }; meta?: { archived?: boolean } }>>("/admin/gameinfo")
			.catch(() => []),
	]);
	const versions = listed
		.filter((v) => v._id.game === params.game)
		.map((v) => ({ version: v._id.version, archived: !!v.meta?.archived }))
		.sort((a, b) => b.version - a.version);
	return { value, metadata, versions };
}
