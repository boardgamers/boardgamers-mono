/**
 * Remove starting emoji from game label
 */
export function gameLabel(label: string): string {
	return label.trim().slice(label.trim().indexOf(" ") + 1);
}

type AliasedGame = { label: string; alias?: string };

/**
 * The public display name of a game (issue #106): the alias when one is set, else the
 * canonical label. Pass `emoji: false` for plain-text contexts (SEO titles, chips) —
 * the emoji comes from the canonical label even for an aliased game.
 */
export function gameDisplayName(info: AliasedGame | null | undefined, opts?: { emoji?: boolean }): string {
	const emoji = opts?.emoji ?? true;
	if (!info) {
		return "";
	}
	if (info.alias) {
		const base = gameEmoji(info.label);
		return emoji && base ? `${base} ${info.alias}` : info.alias;
	}
	return emoji ? info.label.trim() : gameLabel(info.label);
}

/**
 * The canonical game an alias is based on (no emoji), e.g. "Splendor" for
 * alias "Gem Trader" — empty when the game has no alias.
 */
export function gameBasedOn(info: AliasedGame | null | undefined): string {
	return info?.alias ? gameLabel(info.label) : "";
}

/** The subtitle noting the rules source of an aliased game ("Splendor rules"). */
export function gameBasedOnLabel(info: AliasedGame | null | undefined): string {
	const base = gameBasedOn(info);
	return base ? `${base} rules` : "";
}

/**
 * The badge/monogram for a game: the canonical label's emoji when there is one
 * (even for an aliased game, matching {@link gameDisplayName}), otherwise the
 * first letter of the displayed name (the alias when set, else the label) as an
 * uppercase monogram.
 */
export function gameBadge(info: AliasedGame | null | undefined): string {
	if (!info) {
		return "";
	}
	const emoji = gameEmoji(info.label);
	if (emoji) {
		return emoji;
	}
	return [...(info.alias?.trim() || gameLabel(info.label))][0]?.toUpperCase() ?? "";
}

/**
 * Extract the starting emoji of a game label (inverse of {@link gameLabel}) — the
 * first whitespace-separated token, but only when it actually is an emoji (a label
 * like "Container" has no emoji and returns ""). Handles multi-codepoint emoji
 * (e.g. "⚡️" = ⚡ + variation selector).
 *
 * NOTE: `gameLabel`/`gameEmoji` deliberately stay alias-unaware — they split a raw
 * label string. Anything displaying a game name should go through {@link gameDisplayName}.
 */
export function gameEmoji(label: string): string {
	// Mirrors gameLabel()'s quirk: the emoji is everything before the first space — for a
	// one-word label gameLabel returns "" (nothing follows), so the whole word is the "emoji" slot.
	const trimmed = label.trim();
	const head = trimmed.slice(0, trimmed.includes(" ") ? trimmed.indexOf(" ") : undefined);
	// Emoji live outside ASCII; a plain word first token means the label has no emoji.
	return /[^\x00-\x7F]/.test(head) ? head : "";
}
