import { api } from "$lib/api.ts";
import type { GameInfoFront, GameMetadataDoc } from "@bgs/models";

export interface VersionTab {
	version: number;
	archived: boolean;
	ongoing: number;
	// Ids of the ongoing games (capped server-side); feeds the badge popover.
	ongoingGameIds: string[];
}

// One user holding a private-beta grant for this game.
export interface BetaUser {
	userId: string;
	username: string | null;
	maxVersion: number;
}

export async function load({ params }: { params: { game: string; version: string } }): Promise<{
	value: GameInfoFront | null;
	metadata: GameMetadataDoc | null;
	versions: VersionTab[];
	latestVersion: number;
	betaUsers: BetaUser[];
}> {
	const [value, metadata, listed, ongoingCounts] = await Promise.all([
		api.get<GameInfoFront>(`/admin/gameinfo/${params.game}/${params.version}`).catch(() => null),
		api.get<GameMetadataDoc>(`/admin/gameinfo/${encodeURIComponent(params.game)}/meta`).catch(() => null),
		// One entry per version (sorted game asc, version desc) — pick this game's versions.
		api
			.get<Array<{ _id: { game: string; version: number }; meta?: { archived?: boolean } }>>("/admin/gameinfo")
			.catch(() => []),
		// Ongoing (open + active) games per version, for the tab badges.
		api
			.get<Array<{ version: number; count: number; gameIds?: string[] }>>(
				`/admin/gameinfo/${encodeURIComponent(params.game)}/ongoing-games`,
			)
			.catch(() => []),
	]);
	const ongoingByVersion = new Map(ongoingCounts.map((c) => [c.version, c]));
	const versions = listed
		.filter((v) => v._id.game === params.game)
		.map((v) => ({
			version: v._id.version,
			archived: !!v.meta?.archived,
			ongoing: ongoingByVersion.get(v._id.version)?.count ?? 0,
			ongoingGameIds: ongoingByVersion.get(v._id.version)?.gameIds ?? [],
		}))
		.sort((a, b) => b.version - a.version);
	const latestVersion = versions[0]?.version ?? 0;
	// Beta grants only make sense while the latest version is not public.
	const showBeta = !!value && !value.public && +params.version === latestVersion;
	const betaUsers = showBeta
		? await api.get<BetaUser[]>(`/admin/gameinfo/${encodeURIComponent(params.game)}/beta-users`).catch(() => [])
		: [];
	return { value, metadata, versions, latestVersion, betaUsers };
}
