import { gameDisplayName } from "@/utils/game-label";

/**
 * The homepage hero tagline ("Play X, Y and Z online"): the cited games are the
 * most-liked PUBLIC games, each silently linking to its boardgame page, rendered
 * inside a translated sentence.
 */

export type HeroGame = { id: string; name: string };

/** The minimal slice of a game-info the hero needs (loose so tests build fixtures inline). */
export type HeroGameInfo = {
	_id: { game: string };
	label: string;
	alias?: string;
	public: boolean;
	likeCount?: number;
};

/**
 * The historical hardcoded four — the fallback when no public game has a like yet
 * (fresh install, likes wiped), so the hero never renders "Play  online".
 */
export const FALLBACK_HERO_GAMES: readonly HeroGame[] = [
	{ id: "gaia-project", name: "Gaia Project" },
	{ id: "powergrid", name: "Powergrid" },
	{ id: "take6", name: "6nimmt" },
	{ id: "container", name: "Container" },
];

export const HERO_GAME_COUNT = 4;

/** Plain-text display name: alias precedence (#106), no emoji in a sentence. */
const heroName = (info: HeroGameInfo) => gameDisplayName(info, { emoji: false });

/**
 * The games the hero cites: top `count` public games by like count. Deterministic
 * tie-break on the display name (codepoint order, not localeCompare — SSR and the
 * client must produce the identical list regardless of their default locale).
 */
export function heroGames(infos: readonly HeroGameInfo[], count = HERO_GAME_COUNT): readonly HeroGame[] {
	const publicGames = infos.filter((info) => info.public);
	if (!publicGames.some((info) => (info.likeCount ?? 0) > 0)) {
		return FALLBACK_HERO_GAMES;
	}
	return publicGames
		.slice()
		.sort((a, b) => {
			const byLikes = (b.likeCount ?? 0) - (a.likeCount ?? 0);
			if (byLikes !== 0) {
				return byLikes;
			}
			const an = heroName(a);
			const bn = heroName(b);
			return an < bn ? -1 : an > bn ? 1 : 0;
		})
		.slice(0, count)
		.map((info) => ({ id: info._id.game, name: heroName(info) }));
}

// Sentinel injected as the `{games}` placeholder value so the rendered message can be
// split back into the text before/after the game list. U+0000 cannot occur in a catalog.
const GAMES_TOKEN = "\u0000";

/**
 * Split a translated tagline ("Play {games} online") around its `{games}` placeholder,
 * so the component can render the linked game list in the position the language puts it.
 * A catalog value missing the placeholder degrades to the whole text + list appended.
 */
export function taglineParts(message: (inputs: { games: string }) => string): { before: string; after: string } {
	const [before = "", after = ""] = message({ games: GAMES_TOKEN }).split(GAMES_TOKEN);
	return { before, after };
}

export type HeroListPart = { text: string; game?: HeroGame };

/**
 * The localized "A, B and C" list as parts: `game` is set on the name parts (rendered
 * as links) and absent on the separators (", ", " and " — localized by Intl.ListFormat,
 * zero catalog cost).
 */
export function heroListParts(games: readonly HeroGame[], locale: string): HeroListPart[] {
	let index = 0;
	return new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
		.formatToParts(games.map((game) => game.name))
		.map((part) => (part.type === "element" ? { text: part.value, game: games[index++] } : { text: part.value }));
}
