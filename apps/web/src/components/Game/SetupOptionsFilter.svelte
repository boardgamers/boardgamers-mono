<script lang="ts" module>
	import type { GameFront, GameInfoFront } from "@bgs/models";
	import type { GamePace } from "@/utils";
	import type { SetupOptionFilter } from "@/lib/games.svelte";

	export type OptionChoice = { name: string; label: string };
	export type OptionGroup = { name: string; label: string; choices: OptionChoice[] };

	/**
	 * The setup-option filter choices, derived from the option definitions AND the
	 * open games actually loaded: an option only appears if at least one visible
	 * game sets a non-default value for it, and the choices are the values present
	 * (so the chips stay compact + relevant — no "Map layout" with 5 layouts when
	 * the open games only use 2). Only multi-valued `select` options (the review's
	 * clutter fix): checkbox flags are left out.
	 */
	export function deriveOptionGroups(
		info: GameInfoFront | undefined,
		games: GameFront[],
		plain: (text: string) => string
	): OptionGroup[] {
		const groups: OptionGroup[] = [];
		for (const opt of info?.options ?? []) {
			if (opt.type !== "select" || !opt.items?.length) {
				continue;
			}
			// The option's default value (what a game gets when the creator doesn't
			// choose) — matching the new-game form's pre-fill: `default` if it's a
			// valid item, else the first item. Games at the default aren't a
			// meaningful "choice", so they don't make the option filterable.
			const defaultValue =
				typeof opt.default === "string" && opt.items.some((i) => i.name === opt.default)
					? opt.default
					: opt.items[0].name;

			const present: Record<string, true> = {};
			for (const game of games) {
				const value = (game.game.options as Record<string, unknown> | undefined)?.[opt.name];
				if (typeof value === "string" && value !== defaultValue) {
					present[value] = true;
				}
			}
			if (Object.keys(present).length === 0) {
				continue;
			}
			const choices = opt.items
				.filter((item) => present[item.name])
				.map((item) => ({ name: item.name, label: plain(item.label) }));
			groups.push({ name: opt.name, label: plain(opt.label), choices });
		}
		return groups;
	}
</script>

<script lang="ts">
	import marked from "marked";

	// Open-game filters (#55) as chips that sit inline with the lobby title (the
	// parent passes this via GameList's headerContent) — NOT a select-bar above the
	// list, which pushed the column down and misaligned the section titles.
	// Home page: pace chips only. Boardgame page: pace + one chip-group per setup
	// option, derived from the open games actually loaded.
	let {
		info = undefined,
		games = [],
		pace = $bindable(""),
		optionFilter = $bindable(undefined),
	}: {
		/** The boardgame's game-info — its `options` + the loaded games drive the option chips. */
		info?: GameInfoFront | undefined;
		/** The open games currently loaded (bind:games from GameList). */
		games?: GameFront[];
		pace?: "" | GamePace;
		optionFilter?: SetupOptionFilter | undefined;
	} = $props();

	// Option labels can carry markdown (links, emphasis) — chips need plain text.
	const plain = (text: string) =>
		marked(text)
			.replace(/<[^>]+>/g, "")
			.trim();

	let optionGroups = $derived(deriveOptionGroups(info, games, plain));

	// Selection state: option name → required item name ("" = no filter). Rebuilt
	// when the option set changes (navigating between boardgames swaps `info` under
	// the same component instance).
	let selections = $state<Record<string, string>>({});
	let lastOptionsKey = "";
	$effect(() => {
		const key = optionGroups.map((g) => g.name).join("");
		if (key !== lastOptionsKey) {
			lastOptionsKey = key;
			selections = {};
		}
	});

	$effect(() => {
		const next: SetupOptionFilter = {};
		for (const group of optionGroups) {
			const value = selections[group.name];
			if (value) {
				next[group.name] = value;
			}
		}
		optionFilter = Object.keys(next).length > 0 ? next : undefined;
	});

	const paceChoices: { value: "" | GamePace; label: string }[] = [
		{ value: "", label: "All" },
		{ value: "live", label: "⚡ Live" },
		{ value: "async", label: "🐢 Async" },
	];

	// Chip styling, matching the setup-badge / pace-chip design language. The
	// active chip uses the accent; inactive ones are neutral + hover to accent.
	const chipBase =
		"cursor-pointer rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors";
	const chipActive = "border-accent bg-accent text-white";
	const chipInactive =
		"border-gray-300 text-gray-600 hover:border-accent hover:text-accent dark:border-gray-600 dark:text-gray-300 dark:hover:text-accent-lighter";
</script>

<!-- Pace chips (always — the home page's only filter). -->
<div class="flex items-center gap-1" role="group" aria-label="Filter games by pace">
	{#each paceChoices as choice (choice.value)}
		<button
			type="button"
			class="{chipBase} {pace === choice.value ? chipActive : chipInactive}"
			aria-pressed={pace === choice.value}
			onclick={() => (pace = choice.value)}
		>
			{choice.label}
		</button>
	{/each}
</div>

<!-- One chip-group per setup option present in the loaded open games. -->
{#each optionGroups as group (group.name)}
	<div class="flex items-center gap-1" role="group" aria-label={`Filter by ${group.label}`}>
		<span class="text-xs font-medium text-gray-500 dark:text-gray-400">{group.label}:</span>
		<button
			type="button"
			class="{chipBase} {(selections[group.name] ?? '') === '' ? chipActive : chipInactive}"
			aria-pressed={(selections[group.name] ?? "") === ""}
			onclick={() => (selections[group.name] = "")}
		>
			All
		</button>
		{#each group.choices as choice (choice.name)}
			<button
				type="button"
				class="{chipBase} {selections[group.name] === choice.name ? chipActive : chipInactive}"
				aria-pressed={selections[group.name] === choice.name}
				onclick={() => (selections[group.name] = choice.name)}
			>
				{choice.label}
			</button>
		{/each}
	</div>
{/each}
