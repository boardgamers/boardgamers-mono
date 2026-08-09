import { error } from "@sveltejs/kit";
import { get } from "@/lib/api";
import { fetchGameInfo } from "@/lib/game-info.svelte";
import { firstSentence, siteName, truncate } from "@/lib/seo";
import { gameLabel } from "@/utils/game-label";
import { duration } from "@/utils/time";
import type { GameFront, UserFront } from "@bgs/models";

// Card content for the /thumbnail/* pages, derived server-side from the db (via the API)
// and the route params — never from the query string, so a share image can only ever
// render real entity data. Each loader also returns the raw inputs so the matching
// /share.png endpoint can build a content ETag from them (see share-image.server.ts).

export interface OgCardData {
	title: string;
	subtitle?: string;
	game?: string;
	description?: string;
	players?: string;
	pace?: string;
	username?: string;
	karma?: string;
}

export interface CardData {
	card: OgCardData;
	etagData: unknown;
}

export async function loadHomeCard(): Promise<CardData> {
	const card: OgCardData = {
		title: siteName,
		subtitle: "Play Gaia Project, Powergrid, 6nimmt and Container online — all games and the platform are open source!",
	};
	return { card, etagData: card };
}

export async function loadBoardgameCard(boardgameId: string): Promise<CardData> {
	const info = await fetchGameInfo(boardgameId, "latest");
	if (!info) {
		throw error(404, "Boardgame not found");
	}
	const label = gameLabel(info.label);
	const card: OgCardData = {
		title: label,
		subtitle: `Play ${label} online with other people!`,
		game: label,
		description: firstSentence(info.description ?? ""),
	};
	return { card, etagData: { ...card, version: info._id.version } };
}

export async function loadGameCard(gameId: string): Promise<CardData> {
	const game = await get<GameFront>(`/game/${gameId}`).catch((err) => {
		throw error(err?.status === 404 ? 404 : 500, "Game not found");
	});
	if (!game?.game) {
		throw error(404, "Game data is incomplete");
	}

	const info = await fetchGameInfo(game.game.name, game.game.version);
	const label = gameLabel(info?.label ?? game.game.name);

	let card: OgCardData;
	if (game.status === "open") {
		// Chips mirror OpenGame.svelte: players joined + pace (≥24h/player = asynchronous).
		const timePerGame = game.options.timing.timePerGame ?? 0;
		const pace =
			timePerGame >= 24 * 3600
				? `Asynchronous — ${duration(timePerGame)} / player`
				: `Live — ${duration(timePerGame)} / player`;
		card = {
			title: `${label} — open game`,
			subtitle: `Join and play online! ${pace}`,
			game: label,
			players: `${game.players.length} / ${game.options.setup.nbPlayers} players joined`,
			pace,
		};
	} else {
		// Mirrors StartedGame.svelte: title + players chip, round as pace chip.
		const round = game.status === "active" ? (game.context?.round ?? 0) : 0;
		card = {
			title: `${label} game`,
			subtitle:
				game.status === "active"
					? `Round ${round} — ${game.players.length} players`
					: `Finished — ${game.players.length} players`,
			game: label,
			players: `${game.players.length} players`,
			pace: game.status === "active" && round ? `Round ${round}` : undefined,
		};
	}

	// The ETag tracks exactly what the card shows (status/players/round), so any change
	// busts downstream caches on revalidation without a re-render when nothing changed.
	return { card, etagData: card };
}

export async function loadUserCard(username: string): Promise<CardData> {
	// userPublicInfo: username, bio, karma, country — avatar style/id are intentionally
	// not public, so the card always renders the username-seeded monogram (which is also
	// what non-upload avatars look like).
	const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(username)}`).catch((err) => {
		throw error(err?.status === 404 ? 404 : 500, "User not found");
	});
	if (!user) {
		throw error(404, "User not found");
	}

	const card: OgCardData = {
		title: user.account.username,
		subtitle: truncate(user.account.bio ?? "", 140),
		username: user.account.username,
		karma: `${user.account.karma} karma`,
	};
	return { card, etagData: card };
}
