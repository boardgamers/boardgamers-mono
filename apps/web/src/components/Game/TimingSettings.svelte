<!-- Timing controls for the new-game form (#377): named presets (async / rapid /
     live) that fill timePerGame + timePerMove, with a Custom mode revealing the
     full duration dropdowns. Pure client-side convenience — the payload sent to
     the API is unchanged. -->
<script lang="ts">
	import { untrack } from "svelte";
	import { duration } from "@/utils";
	import { m } from "@/lib/i18n/messages";
	import { matchTimingPreset, timingPresets, type TimingPresetId } from "@/lib/timing-presets";

	let { timePerGame = $bindable(), timePerMove = $bindable() }: { timePerGame: number; timePerMove: number } = $props();

	// Start in custom mode when the initial values (defaults or a remembered
	// setup) don't correspond to a named preset.
	let custom = $state(untrack(() => matchTimingPreset(timePerGame, timePerMove) === null));
	let active = $derived(custom ? null : matchTimingPreset(timePerGame, timePerMove));

	const labels: Record<TimingPresetId, () => string> = {
		async: m.newGame_preset_async,
		rapid: m.newGame_preset_rapid,
		live: m.newGame_preset_live,
	};
	const help: Record<TimingPresetId, () => string> = {
		async: m.newGame_preset_asyncHelp,
		rapid: m.newGame_preset_rapidHelp,
		live: m.newGame_preset_liveHelp,
	};

	const chipClass = (selected: boolean) =>
		`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
			selected
				? "border-primary bg-primary text-white"
				: "border-gray-300 text-gray-700 hover:border-primary hover:text-primary dark:border-gray-600 dark:text-gray-200 dark:hover:text-primary-lighter"
		}`;
</script>

<div class="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label={m.newGame_presetAria()}>
	{#each timingPresets as preset (preset.id)}
		<button
			type="button"
			class={chipClass(active === preset.id)}
			aria-pressed={active === preset.id}
			onclick={() => {
				timePerGame = preset.timePerGame;
				timePerMove = preset.timePerMove;
				custom = false;
			}}
		>
			{labels[preset.id]()}
		</button>
	{/each}
	<button type="button" class={chipClass(custom)} aria-pressed={custom} onclick={() => (custom = true)}>
		{m.newGame_preset_custom()}
	</button>
</div>

{#if active}
	<p class="mb-3 text-sm text-gray-500 dark:text-gray-400" data-testid="preset-summary">
		{help[active]()}
		{m.newGame_presetSummary({ game: duration(timePerGame), move: duration(timePerMove) })}
	</p>
{:else}
	<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
		{m.newGame_timingHelp()}
	</p>
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<div class="mb-3">
			<label for="timePerGame">{m.newGame_timePerGame()}</label>
			<select
				bind:value={timePerGame}
				id="timePerGame"
				class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
			>
				{#each [60, 180, 300, 600, 1800, 3600, 6 * 3600, 24 * 3600, 3 * 24 * 3600, 10 * 24 * 3600] as x (x)}
					<option value={x}>{duration(x)}</option>
				{/each}
			</select>
		</div>

		<div class="mb-3">
			<label for="timePerMove">{m.newGame_timePerMove()}</label>
			<select
				bind:value={timePerMove}
				id="timePerMove"
				class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
			>
				{#each [5, 10, 30, 60, 5 * 60, 15 * 60, 3600, 2 * 3600, 6 * 3600, 24 * 3600] as x (x)}
					<option value={x}>{duration(x)}</option>
				{/each}
			</select>
		</div>
	</div>
{/if}
