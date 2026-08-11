import removeMarkdown from "remove-markdown";
import { minBy, sortBy } from "lodash";
import type { GameFront, GameInfoFront } from "@bgs/models";
import type { JsonObject } from "type-fest";
import { gameLabel } from "@/utils/game-label";
import { duration } from "@/utils/time";
import { shareImageUrl, type SeoData } from "@/lib/seo";

/** Game-specific options, keyed by option name. */
const gameOptions = (game: { game: { options?: unknown } } | null | undefined): JsonObject =>
	(game?.game.options ?? {}) as JsonObject;

function label(gameInfo: GameInfoFront | null | undefined): string {
	return gameLabel(gameInfo?.label ?? "");
}

/**
 * OG/head meta for a game page, computed from the game doc + its gameinfo. Used for the
 * SSR snapshot (in the game page's load) and as the live client override (the game
 * layout recomputes it reactively as the game evolves). Always noindex — game pages are
 * not indexed.
 */
export function gameSeo(game: GameFront | null | undefined, gameInfo: GameInfoFront | null | undefined): SeoData {
	const gameId = game?._id ?? "";
	const image = shareImageUrl({ kind: "game", id: gameId });
	const base = { noindex: true as const, image };

	if (!game) {
		return { ...base, title: `${label(gameInfo)} game ${gameId}` };
	}

	// Mongo validates the games schema with "warn", so a legacy/corrupt doc can be missing
	// any of these — fall back instead of throwing (a 500 here breaks the whole game page).
	const players = game.players ?? [];
	const setup = game.options?.setup;
	const timing = game.options?.timing;

	if (game.status === "open") {
		const options = (gameInfo?.options ?? [])
			.filter((x) => !!gameOptions(game)[x.name])
			.map((pref) =>
				pref.type === "checkbox"
					? pref.label
					: pref.type === "select" && pref.items
						? (
								pref.label +
								": " +
								(pref.items.find((x) => x.name === gameOptions(game)[pref.name])?.label ?? "")
							).trim()
						: "",
			)
			.filter(Boolean)
			.map((str) => `- ${removeMarkdown(str)}`)
			.join("\n");
		const expansions =
			(game.game.expansions?.length ?? 0) > 0 ? `\n      Expansions: ${game.game.expansions.join(",")}\n` : "";
		return {
			...base,
			title: `${label(gameInfo)} game ${gameId}`,
			description: `${players.length} / ${setup?.nbPlayers ?? "?"} players. Timer of ${duration(
				timing?.timePerGame ?? 0,
			)} per player, with an additional ${duration(timing?.timePerMove ?? 0)} per move.${expansions}${options}`,
		};
	}

	// Started / finished / cancelled game.
	let title: string;
	if (game.status === "active") {
		title = `${label(gameInfo)} game ${gameId}`;
	} else if (game.cancelled) {
		title = `Cancelled - ${label(gameInfo)} game`;
	} else {
		const victor = minBy(players, "ranking");
		title = victor ? `${victor.name}'s victory! - ${label(gameInfo)} game` : `${label(gameInfo)} game`;
	}

	let description: string | undefined;
	if (game.status === "active") {
		description = `Round ${game.context?.round ?? 0}\n\n${players.map((pl) => `- ${pl.name} (${pl.score} pts)`).join("\n")}`;
	} else if (!game.cancelled) {
		description = sortBy(players, "ranking")
			.map((player) => `${player.ranking}° ${player.name} (${player.score}pts)`)
			.join("\n");
	}

	return { ...base, title, description };
}
