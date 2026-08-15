import { api } from "$lib/api.ts";

// The metadata editor edits the game-level `gameMetadatas` doc (label/alias/
// description/rules/links/players/expansions), one per game (#298). It lists every
// game — one row per game, derived from the distinct game ids — then loads each
// game's full metadata doc on demand in the page.
export interface BoardgameMetaRow {
	game: string;
	label: string;
}

export async function load(): Promise<{ games: BoardgameMetaRow[] }> {
	// The list endpoint returns one entry per version; collapse to distinct games.
	const listed = await api
		.get<Array<{ _id: { game: string; version: number }; label: string }>>("/admin/gameinfo")
		.catch(() => []);
	const seen = new Map<string, BoardgameMetaRow>();
	for (const entry of listed) {
		if (!seen.has(entry._id.game)) {
			seen.set(entry._id.game, { game: entry._id.game, label: entry.label });
		}
	}
	return { games: [...seen.values()] };
}
