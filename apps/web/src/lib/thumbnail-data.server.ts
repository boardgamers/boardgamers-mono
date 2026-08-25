import { error } from "@sveltejs/kit";
import removeMarkdown from "remove-markdown";
import type { JsonObject } from "type-fest";
import { apiFetch, get, toKitError } from "@/lib/api";
import { fetchGameInfo, fetchGameInfos } from "@/lib/game-info.svelte";
import { countryFlag, countryName } from "@/lib/countries";
import { firstSentence, siteName, truncate } from "@/lib/seo";
import { m } from "@/lib/i18n/messages";
import { gameBasedOn, gameDisplayName, gameEmoji } from "@/utils/game-label";
import { gamePace } from "@/utils/time";
import type { GameFront, GameInfoFront, GamePreferencesFront, UserFront } from "@bgs/models";

// Card content for the /thumbnail/* pages, derived server-side from the db (via the API)
// and the route params — never from the query string, so a share image can only ever
// render real entity data. Each loader also returns the raw inputs so the matching
// /share.webp endpoint can build a content ETag from them (see share-image.server.ts).

export interface OgCardData {
	title: string;
	subtitle?: string;
	game?: string;
	/** Game emoji extracted from the label (e.g. "🌏") — the badge; falls back to a monogram when absent. */
	emoji?: string;
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
	/** Game card: crucial setup options (map, expansions, …) as chip strings. */
	gameOptions?: string[];
}

export interface CardData {
	card: OgCardData;
	etagData: unknown;
}

export async function loadHomeCard(): Promise<CardData> {
	const card: OgCardData = {
		title: siteName,
		subtitle: m.thumbnail_homeSubtitle(),
	};
	return { card, etagData: card };
}

export async function loadBoardgameCard(boardgameId: string): Promise<CardData> {
	const info = await fetchGameInfo(boardgameId, "latest");
	if (!info) {
		throw error(404, "Boardgame not found");
	}
	const label = gameDisplayName(info, { emoji: false });
	const base = gameBasedOn(info);
	const card: OgCardData = {
		title: label,
		// An aliased game leads with the alias; the canonical name is the rules source.
		subtitle: base ? `Mechanics of ${base} — play online!` : `Play ${label} online with other people!`,
		game: label,
		emoji: gameEmoji(info.label),
		description: firstSentence(info.description ?? ""),
	};
	return { card, etagData: { ...card, version: info._id.version } };
}

export async function loadGameCard(gameId: string): Promise<CardData> {
	const game = await get<GameFront>(`/game/${gameId}`).catch(toKitError);
	if (!game?.game) {
		throw error(404, "Game data is incomplete");
	}

	const info = await fetchGameInfo(game.game.name, game.game.version);
	const label = info ? gameDisplayName(info, { emoji: false }) : game.game.name;
	const emoji = info ? gameEmoji(info.label) : gameEmoji(game.game.name);
	const basedOn = gameBasedOn(info);
	const gameOptions = crucialGameOptions(game, info);

	let card: OgCardData;
	if (game.status === "open") {
		// Chips mirror OpenGame.svelte: players joined + pace (≥24h/player = asynchronous).
		// Subtitle stays short (the full pace is a chip) so it doesn't wrap; the pace chip is
		// compact ("Asynchronous" / "Live") to leave room for the option chips on one row.
		const timePerGame = game.options.timing.timePerGame ?? 0;
		const pace = gamePace(timePerGame) === "async" ? "Asynchronous" : "Live";
		card = {
			title: label,
			subtitle: basedOn ? `Mechanics of ${basedOn} — join and play online!` : "Join and play online!",
			game: label,
			emoji,
			players: `${game.players.length} / ${game.options.setup.nbPlayers} players joined`,
			pace,
			gameOptions,
		};
	} else {
		// Mirrors StartedGame.svelte: title + players chip, round as pace chip.
		const round = game.status === "active" ? (game.context?.round ?? 0) : 0;
		card = {
			title: label,
			subtitle:
				(game.status === "active"
					? `Round ${round} — ${game.players.length} players`
					: `Finished — ${game.players.length} players`) + (basedOn ? ` · Mechanics of ${basedOn}` : ""),
			game: label,
			emoji,
			players: `${game.players.length} players`,
			pace: game.status === "active" && round ? `Round ${round}` : undefined,
			gameOptions,
		};
	}

	// The ETag tracks exactly what the card shows (status/players/round/options), so any
	// change busts downstream caches on revalidation without a re-render when nothing changed.
	return { card, etagData: card };
}

// Cap on option chips so the card stays readable next to the players/pace chips;
// anything beyond it is summarized as a "+N more" chip.
const MAX_OPTION_CHIPS = 3;

/**
 * The setup choices that define the game — same heuristic as the og:description in
 * game-seo.ts: selected checkbox labels, select choices as "Label: value", and expansions
 * (resolved to their labels, like the lobby does). Returns at most MAX_OPTION_CHIPS
 * strings; when more options exist the last chip is "+N more".
 */
function crucialGameOptions(game: GameFront, info: GameInfoFront | null | undefined): string[] | undefined {
	const values = (game.game.options ?? {}) as JsonObject;
	const chips = (info?.options ?? [])
		.filter((pref) => !!values[pref.name])
		.map((pref) =>
			pref.type === "checkbox"
				? pref.label
				: pref.type === "select" && pref.items
					? pref.label + ": " + pref.items.find((item) => item.name === values[pref.name])?.label
					: "",
		)
		.filter(Boolean);

	for (const expansion of game.game.expansions ?? []) {
		chips.push(`+ ${info?.expansions?.find((xp) => xp.name === expansion)?.label ?? expansion} expansion`);
	}

	if (chips.length === 0) {
		return undefined;
	}
	const kept = chips.slice(0, MAX_OPTION_CHIPS).map((chip) => removeMarkdown(chip));
	const hidden = chips.length - kept.length;
	return hidden > 0 ? [...kept, `+${hidden} more`] : kept;
}

export async function loadUserCard(username: string): Promise<CardData> {
	// userPublicInfo: username, bio, karma, country. The avatar image is public via
	// /api/user/<id>/avatar (uploaded webp, or the dicebear SVG), so embed it directly.
	const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(username)}`).catch(toKitError);

	const userId = user._id!;
	const [elo, gameInfos, avatar] = await Promise.all([
		get<GamePreferencesFront[]>(`/user/${userId}/games/elo`).catch(() => [] as GamePreferencesFront[]),
		fetchGameInfos().catch(() => ({}) as Awaited<ReturnType<typeof fetchGameInfos>>),
		fetchAvatarDataUrl(userId),
	]);

	// Top boardgame by games played (the hovercard sorts the same way), with its elo.
	const top = elo.filter((pref) => pref.elo).sort((a, b) => (b.elo!.games ?? 0) - (a.elo!.games ?? 0))[0];
	const topInfo = top ? gameInfos[`${top.game}/latest` as keyof typeof gameInfos] : undefined;
	const topLabel = top ? (topInfo ? gameDisplayName(topInfo, { emoji: false }) : top!.game) : "";

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
