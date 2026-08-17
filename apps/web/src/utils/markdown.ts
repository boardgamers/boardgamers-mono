import marked from "marked";

export function oneLineMarked(text: string) {
	return marked(text).replace(/<\/?p>/g, "");
}

/**
 * One-line markdown for a label rendered *inside* an `<a>` (e.g. an open-game row
 * that is itself a link). Nested `<a>` tags are invalid HTML: the browser parses the
 * SSR'd inner anchor differently than Svelte's client render, which breaks hydration
 * (hydration_mismatch → client re-render → layout shift). Strip anchors, keeping
 * their text — the whole row already links to the game.
 */
export function oneLineMarkedNoLinks(text: string) {
	return oneLineMarked(text).replace(/<\/?a(?:\s[^>]*)?>/g, "");
}
