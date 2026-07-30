import type { Action } from "svelte/action";

/**
 * Svelte action that trims leading/trailing whitespace from a text input.
 *
 * Applies to pasted content (a common source of stray spaces/newlines) as well
 * as on blur, so identifier fields (game IDs, boardgame names, page names)
 * never carry invisible whitespace into an API path or request body.
 *
 * Usage: `<input bind:value={id} use:trim />`
 */
export const trim: Action<HTMLInputElement> = (node) => {
	function apply() {
		const trimmed = node.value.trim();
		if (trimmed !== node.value) {
			node.value = trimmed;
			// Emit a bubbling `input` so Svelte's `bind:value` picks up the change.
			node.dispatchEvent(new Event("input", { bubbles: true }));
		}
	}

	node.addEventListener("paste", () => setTimeout(apply));
	node.addEventListener("blur", apply);

	return {
		destroy() {
			node.removeEventListener("blur", apply);
		},
	};
};
