/**
 * Split a boardgame label into its leading emoji and the remaining name.
 * Labels are stored as "<emoji> <Name>" but spacing is inconsistent (sometimes
 * no space after the emoji), so this normalizes to a guaranteed single space.
 *   " 🌏 Gaia Project" -> { emoji: "🌏", name: "Gaia Project" }
 *   "⚡️ Powergrid"      -> { emoji: "⚡️", name: "Powergrid" }
 */
export function gameLabelParts(label: string | undefined): { emoji: string; name: string } {
	if (!label) return { emoji: "", name: "" };
	const trimmed = label.trim();
	const space = trimmed.indexOf(" ");
	if (space <= 0) return { emoji: "", name: trimmed };
	return { emoji: trimmed.slice(0, space), name: trimmed.slice(space + 1).trim() };
}

/** Convenience: just the emoji part of a boardgame label. */
export function gameEmoji(label: string | undefined): string {
	return gameLabelParts(label).emoji;
}

export function filesize(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
	if (bytes < 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
	return `${(bytes / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}
