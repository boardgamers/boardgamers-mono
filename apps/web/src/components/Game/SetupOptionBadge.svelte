<script lang="ts">
	import SanitizedHtml from "../SanitizedHtml.svelte";
	import { oneLineMarked, oneLineMarkedNoLinks } from "@/utils";
	import { Badge } from "@/modules/cdk";
	import type { GameInfoFront } from "@bgs/models";
	import type { JsonValue } from "type-fest";

	// A setup-option badge that renders any markdown (including links) with white
	// link text, matching the game-sidebar badge style. Used by both the game sidebar
	// and the open-game lobby so they render setup options identically.
	let {
		pref,
		value,
		color = "secondary",
		noLinks = false,
	}: {
		pref: NonNullable<GameInfoFront["options"]>[number];
		value: unknown;
		color?: string;
		/** Strip `<a>` tags (keep their text). Required when the badge renders inside an
		 * `<a>` (the open-game row): nested anchors are invalid HTML and break hydration. */
		noLinks?: boolean;
	} = $props();

	let label = $derived.by(() => {
		if (pref.type === "checkbox") {
			return pref.label;
		}
		if (pref.type === "select" && pref.items) {
			const item = pref.items.find((x) => x.name === (value as JsonValue));
			if (item) {
				return `${pref.label}: ${item.label}`;
			}
		}
		return null;
	});
</script>

{#if label}
	<Badge {color} class="setup-badge"
		><SanitizedHtml html={noLinks ? oneLineMarkedNoLinks(label) : oneLineMarked(label)} /></Badge
	>
{/if}
