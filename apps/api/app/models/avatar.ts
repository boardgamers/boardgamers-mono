import { createAvatar, type Style } from "@dicebear/core";
import * as styles from "@dicebear/collection";

export const DEFAULT_AVATAR_STYLE = "avataaars";

// Whitelisted DiceBear v9 styles selectable on the account page.
// Keep in sync with `avatarStyles` in apps/web/src/routes/(app)/account/+page.svelte.
// "gridy"/"jdenticon" existed in DiceBear v4 but were dropped in v9 — they map to identicon.
// oxlint-disable-next-line typescript/no-explicit-any -- each style has its own options type; the record must unify them
const avatarStyles: Record<string, Style<any>> = {
	adventurer: styles.adventurer,
	"adventurer-neutral": styles.adventurerNeutral,
	avataaars: styles.avataaars,
	"big-ears": styles.bigEars,
	"big-ears-neutral": styles.bigEarsNeutral,
	"big-smile": styles.bigSmile,
	bottts: styles.bottts,
	croodles: styles.croodles,
	"croodles-neutral": styles.croodlesNeutral,
	identicon: styles.identicon,
	initials: styles.initials,
	micah: styles.micah,
	miniavs: styles.miniavs,
	"open-peeps": styles.openPeeps,
	personas: styles.personas,
	"pixel-art": styles.pixelArt,
	"pixel-art-neutral": styles.pixelArtNeutral,
};

export type AvatarStyle =
	| "adventurer"
	| "adventurer-neutral"
	| "avataaars"
	| "big-ears"
	| "big-ears-neutral"
	| "big-smile"
	| "bottts"
	| "croodles"
	| "croodles-neutral"
	| "identicon"
	| "initials"
	| "micah"
	| "miniavs"
	| "open-peeps"
	| "personas"
	| "pixel-art"
	| "pixel-art-neutral";

// Styles users could have stored from the DiceBear v4 era — no longer in v9.
const removedStyles: Record<string, AvatarStyle> = {
	gridy: "identicon",
	jdenticon: "identicon",
};

export function isAvatarStyle(name: string): name is AvatarStyle {
	return name in avatarStyles;
}

/**
 * Generates a DiceBear avatar SVG locally (no external HTTP call).
 * Unknown/removed style names fall back instead of 500ing — stored avatars
 * predate the whitelist.
 */
export function generateAvatar(styleName: string | undefined, seed: string, size?: number): string {
	const name = styleName ?? DEFAULT_AVATAR_STYLE;
	const style = avatarStyles[isAvatarStyle(name) ? name : (removedStyles[name] ?? DEFAULT_AVATAR_STYLE)];
	return createAvatar(style, { seed, ...(size ? { size } : {}) }).toString();
}
