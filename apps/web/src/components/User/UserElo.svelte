<script lang="ts">
	import { resolve } from "$app/paths";
	import { useGameInfos, gameInfoKey } from "@/lib/game-info.svelte";
	import { gameDisplayName } from "@/utils/game-label";
	import { m } from "@/lib/i18n/messages";
	import type { GamePreferencesFront } from "@bgs/models";
	import IconInfoCircleFill from "@/components/icons/IconInfoCircleFill.svelte";

	// SSR'd by the user/[username] load function — no client-side fetch needed.
	let { gamePreferences }: { gamePreferences: GamePreferencesFront[] } = $props();

	// Game infos come from the root-provided context (set during SSR), so this resolves
	// synchronously. Fall back to the raw game id if somehow missing.
	const gameInfos = useGameInfos();
	function gameName(game: string): string {
		const info = gameInfos[gameInfoKey(game, "latest")];
		return info ? gameDisplayName(info) : game;
	}
</script>

{#if gamePreferences.some((pref) => pref.elo)}
	<div>
		<h3 class="flex items-center gap-1 font-semibold">
			Elo <a href={resolve("/(app)/page/[part1]", { part1: "elo" })}
				><IconInfoCircleFill class="text-gray-500 text-xs dark:text-gray-400" /></a
			>
		</h3>
		<ul class="divide-y divide-accent/60 rounded-lg border border-accent text-start">
			{#each gamePreferences.filter((pref) => !!pref.elo) as gamePref (gamePref.game)}
				<li class="cursor-pointer px-4 py-2 hover:bg-accent/5">
					<span>
						{gameName(gamePref.game)} - <b>{gamePref.elo!.value}</b> in
						{gamePref.elo!.games}
						{gamePref.elo!.games === 1 ? m.common_game() : m.common_game_plural()}
					</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}
