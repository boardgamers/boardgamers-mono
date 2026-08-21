import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import { api } from "$lib/api.ts";

// Boardgame landing: no version in the URL (versions change) — bounce to the
// latest version's page. A missing/empty list means the game doesn't exist.
export async function load({ params }: { params: { game: string } }): Promise<{ game: string; exists: boolean }> {
	const versions = await api
		.get<Array<{ version: number; archived: boolean }>>(`/admin/gameinfo/${encodeURIComponent(params.game)}/versions`)
		.catch(() => []);
	const latest = versions[0]?.version;
	if (latest === undefined) {
		return { game: params.game, exists: false };
	}
	redirect(302, resolve("/game/[game]/[version]", { game: params.game, version: String(latest) }));
}
