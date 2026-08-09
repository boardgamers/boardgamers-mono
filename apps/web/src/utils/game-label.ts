/**
 * Remove starting emoji from game label
 */
export function gameLabel(label: string): string {
	return label.trim().slice(label.trim().indexOf(" ") + 1);
}

/**
 * Extract the starting emoji of a game label (inverse of {@link gameLabel}) — the
 * first whitespace-separated token, but only when it actually is an emoji (a label
 * like "Container" has no emoji and returns ""). Handles multi-codepoint emoji
 * (e.g. "⚡️" = ⚡ + variation selector).
 */
export function gameEmoji(label: string): string {
	// Mirrors gameLabel()'s quirk: the emoji is everything before the first space — for a
	// one-word label gameLabel returns "" (nothing follows), so the whole word is the "emoji" slot.
	const trimmed = label.trim();
	const head = trimmed.slice(0, trimmed.includes(" ") ? trimmed.indexOf(" ") : undefined);
	// Emoji live outside ASCII; a plain word first token means the label has no emoji.
	return /[^\x00-\x7F]/.test(head) ? head : "";
}
