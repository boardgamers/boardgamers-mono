import { api } from "$lib/api.ts";
import type { GameInfoFront, GameMetadataDoc } from "@bgs/models";

// The meta GET adds `sourceHash` (content hash of the current
// description/rules/credits, null when there's no source text) and
// `translationNeeds` (the languages whose overlay needs translation by the
// server's combined markdown + option-label predicate) so the page shows the
// server's own rule instead of re-deriving it client-side.
export type GameMetadataWithHash = GameMetadataDoc & {
	sourceHash?: string | null;
	translationNeeds?: string[];
};

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
	metadata: GameMetadataWithHash | null;
	versions: VersionTab[];
	latestVersion: number;
	betaUsers: BetaUser[];
}> {
	const [value, metadata, listed, ongoingCounts] = await Promise.all([
		api.get<GameInfoFront>(`/admin/gameinfo/${params.game}/${params.version}`).catch(() => null),
		api.get<GameMetadataWithHash>(`/admin/gameinfo/${encodeURIComponent(params.game)}/meta`).catch(() => null),
		// This game's versions, latest first (the gameinfo list is one-per-game now).
		api
			.get<Array<{ version: number; archived: boolean }>>(`/admin/gameinfo/${encodeURIComponent(params.game)}/versions`)
			.catch(() => []),
		// Ongoing (open + active) games per version, for the tab badges.
		api
			.get<Array<{ version: number; count: number; gameIds?: string[] }>>(
				`/admin/gameinfo/${encodeURIComponent(params.game)}/ongoing-games`,
			)
			.catch(() => []),
	]);
	const ongoingByVersion = new Map(ongoingCounts.map((c) => [c.version, c]));
	const versions = listed.map((v) => ({
		version: v.version,
		archived: v.archived,
		ongoing: ongoingByVersion.get(v.version)?.count ?? 0,
		ongoingGameIds: ongoingByVersion.get(v.version)?.gameIds ?? [],
	}));
	const latestVersion = versions[0]?.version ?? 0;
	// Beta grants only make sense while the latest version is not public.
	const showBeta = !!value && !value.public && +params.version === latestVersion;
	const betaUsers = showBeta
		? await api.get<BetaUser[]>(`/admin/gameinfo/${encodeURIComponent(params.game)}/beta-users`).catch(() => [])
		: [];
	return { value, metadata, versions, latestVersion, betaUsers };
}
