import { error } from "@sveltejs/kit";
import { apiFetch, get } from "@/lib/api";
import { fetchGameInfo, fetchGameInfos } from "@/lib/game-info.svelte";
import { countryFlag, countryName } from "@/lib/countries";
import { firstSentence, siteName, truncate } from "@/lib/seo";
import { gameLabel } from "@/utils/game-label";
import { duration } from "@/utils/time";
import type { GameFront, GamePreferencesFront, UserFront } from "@bgs/models";

// Card content for the /thumbnail/* pages, derived server-side from the db (via the API)
// and the route params — never from the query string, so a share image can only ever
// render real entity data. Each loader also returns the raw inputs so the matching
// /share.webp endpoint can build a content ETag from them (see share-image.server.ts).

export interface OgCardData {
	title: string;
	subtitle?: string;
	game?: string;
	description?: string;
	players?: string;
	pace?: string;
	username?: string;
	karma?: string;
	/** User card: inlined avatar (data URL) — falls back to a username monogram when absent. */
	avatar?: string;
	/** User card: "🇫🇷 France" (flag + name) chip. */
	country?: string;
	/** User card: top boardgame by games played — "Gaia Project · 1520 elo · 87 games". */
	topGame?: string;
	/** Call-to-action chip (e.g. "Play boardgames online"). */
	cta?: string;
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
	// userPublicInfo: username, bio, karma, country. The avatar image is public via
	// /api/user/<id>/avatar (uploaded webp, or the dicebear SVG), so embed it directly.
	const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(username)}`).catch((err) => {
		throw error(err?.status === 404 ? 404 : 500, "User not found");
	});
	if (!user) {
		throw error(404, "User not found");
	}

	const userId = user._id!;
	const [elo, gameInfos, avatar] = await Promise.all([
		get<GamePreferencesFront[]>(`/user/${userId}/games/elo`).catch(() => [] as GamePreferencesFront[]),
		fetchGameInfos().catch(() => ({}) as Awaited<ReturnType<typeof fetchGameInfos>>),
		fetchAvatarDataUrl(userId),
	]);

	// Top boardgame by games played (the hovercard sorts the same way), with its elo.
	const top = elo.filter((pref) => pref.elo).sort((a, b) => (b.elo!.games ?? 0) - (a.elo!.games ?? 0))[0];
	const topLabel = top ? gameLabel(gameInfos[`${top.game}/latest` as keyof typeof gameInfos]?.label ?? top.game) : "";

	const card: OgCardData = {
		title: user.account.username,
		subtitle: truncate(user.account.bio ?? "", 140),
		username: user.account.username,
		karma: `${user.account.karma} karma`,
		country: user.account.country
			? `${countryFlag(user.account.country)} ${countryName(user.account.country) ?? ""}`.trim()
			: undefined,
		avatar,
		topGame: top && topLabel ? `${topLabel} · ${top.elo!.value} elo · ${top.elo!.games} games` : undefined,
		cta: "Play online",
	};
	// ETag covers every field the card renders (avatar image bytes too), so a new avatar,
	// a karma change, or a new top game busts the cache on revalidation.
	return { card, etagData: { ...card, avatarBytes: avatar ? avatar.length + avatar.slice(-24) : null } };
}

// Inline the avatar as a data URL so the /thumbnail page renders it with no extra
// request (the share renderer screenshots the page). DiceBear returns an SVG; uploads
// are webp. Falls back to undefined (→ username monogram) on any error.
async function fetchAvatarDataUrl(userId: string): Promise<string | undefined> {
	try {
		const res = await apiFetch(`/user/${userId}/avatar`, {});
		if (!res.ok) {
			return undefined;
		}
		const mime = res.headers.get("content-type") ?? "image/webp";
		const buf = Buffer.from(await res.arrayBuffer());
		return `data:${mime};base64,${buf.toString("base64")}`;
	} catch {
		return undefined;
	}
}
