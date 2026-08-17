<script lang="ts" module>
	import type { GameInfoFront } from "@bgs/models";

	type SetupOption = NonNullable<GameInfoFront["options"]>[number];

	// Only an admin-set `default` marks an option's default — there is no
	// first-item fallback: Powergrid's map has no `default`, so "Map: Germany"
	// still badges (Germany is just one of many maps), while gaia-project's
	// `default: "standard"` hides "Map layout: Standard". A checkbox's default
	// is unchecked unless `default === true`.
	export function setupOptionDefault(pref: SetupOption): unknown {
		if (pref.type === "select") {
			return typeof pref.default === "string" && pref.items?.some((item) => item.name === pref.default)
				? pref.default
				: undefined;
		}
		if (pref.type === "checkbox") {
			return pref.default === true;
		}
		return undefined;
	}

	/** Whether the option's stored value differs from its admin-set default (i.e. worth badging). */
	export function isNonDefaultSetupOption(pref: SetupOption, value: unknown): boolean {
		return !!value && value !== setupOptionDefault(pref);
	}
</script>

<script lang="ts">
	import SanitizedHtml from "../SanitizedHtml.svelte";
	import { oneLineMarked, oneLineMarkedNoLinks } from "@/utils";
	import { Badge } from "@/modules/cdk";
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
		if (!isNonDefaultSetupOption(pref, value)) {
			return null;
		}
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
