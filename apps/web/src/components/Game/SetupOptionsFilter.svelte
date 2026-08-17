<script lang="ts">
	import marked from "marked";
	import { untrack } from "svelte";
	import { Input } from "@/modules/cdk";
	import type { GameInfoFront } from "@bgs/models";
	import type { GamePace } from "@/utils";
	import type { SetupOptionFilter } from "@/lib/games.svelte";

	// Open-game filters (#55): pace (live/async) plus one select per setup option of
	// the game (map / variant / …), built from the game-info's option definitions so
	// the labels match what the new-game form shows. Rendered above the lobby list
	// on the home page (pace only) and the boardgame page (pace + setup options).
	let {
		info = undefined,
		pace = $bindable(""),
		optionFilter = $bindable(undefined),
	}: {
		/** The boardgame's game-info — its `options` drive the per-option selects. */
		info?: GameInfoFront | undefined;
		pace?: "" | GamePace;
		optionFilter?: SetupOptionFilter | undefined;
	} = $props();

	// Filterable setup options: selects and checkboxes (categories/hidden are form
	// structure, not game options).
	let filterOptions = $derived((info?.options ?? []).filter((opt) => opt.type === "select" || opt.type === "checkbox"));

	// Selection state: "" = no filter, otherwise the required value (item name for
	// selects, "true" for checkboxes). Initialized with an entry per option — a
	// `bind:value` into a missing key is undefined, which Svelte rejects (Input's
	// `value` has a fallback). Rebuilt when the option set changes (navigating
	// between boardgames swaps `info` under the same component instance).
	const initialSelections = untrack(() =>
		Object.fromEntries(
			(info?.options ?? [])
				.filter((opt) => opt.type === "select" || opt.type === "checkbox")
				.map((opt) => [opt.name, ""])
		)
	);
	let selections = $state<Record<string, string>>(initialSelections);

	let lastOptionsKey = Object.keys(initialSelections).join("");
	$effect(() => {
		const key = filterOptions.map((opt) => opt.name).join("");
		if (key !== lastOptionsKey) {
			lastOptionsKey = key;
			selections = Object.fromEntries(filterOptions.map((opt) => [opt.name, ""]));
		}
	});

	$effect(() => {
		const next: SetupOptionFilter = {};
		for (const opt of filterOptions) {
			const value = selections[opt.name];
			if (value) {
				next[opt.name] = opt.type === "checkbox" ? true : value;
			}
		}
		optionFilter = Object.keys(next).length > 0 ? next : undefined;
	});

	// Option labels can carry markdown (links, emphasis) — selects need plain text.
	const plain = (text: string) =>
		marked(text)
			.replace(/<[^>]+>/g, "")
			.trim();
</script>

<div class="mb-2 flex flex-wrap items-center gap-2">
	<span class="text-sm font-medium text-gray-500 dark:text-gray-400">Find a game:</span>
	<div class="w-full sm:w-40">
		<Input type="select" bind:value={pace} aria-label="Filter games by pace" title="Filter games by pace">
			<option value="">Pace: any</option>
			<option value="live">⚡ Live games</option>
			<option value="async">🐢 Async games</option>
		</Input>
	</div>
	{#each filterOptions as opt (opt.name)}
		<div class="w-full sm:w-60">
			<Input type="select" bind:value={selections[opt.name]} aria-label={`Filter by ${plain(opt.label)}`}>
				{#if opt.type === "checkbox"}
					<option value="">{plain(opt.label)}: any</option>
					<option value="true">{plain(opt.label)}</option>
				{:else}
					<option value="">{plain(opt.label)}: any</option>
					{#each opt.items ?? [] as item (item.name)}
						<option value={item.name}>{plain(item.label)}</option>
					{/each}
				{/if}
			</Input>
		</div>
	{/each}
</div>
