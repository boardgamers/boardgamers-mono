import type { GameInfoFront, PageFront } from "@bgs/models";
import { api } from "./api.ts";

export const data: { games: GameInfoFront[]; pages: PageFront[] } = $state({
	games: [],
	pages: [],
});

export async function loadGames() {
	data.games = await api.get<GameInfoFront[]>("/admin/gameinfo");
}

export async function loadPages() {
	data.pages = await api.get<PageFront[]>("/admin/page");
}
