<script lang="ts">
	import { resolve } from "$app/paths";
	import PreferencesChooser from "@/components/User/PreferencesChooser.svelte";
	import IconInfoCircleFill from "@/components/icons/IconInfoCircleFill.svelte";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";
	import { getContext } from "svelte";

	const context = getContext("game") as GameContext;
	let gameInfo = $derived(context.gameInfo);

	let showPreferences = $derived(
		!!gameInfo?.viewer?.alternate?.url || (gameInfo?.preferences?.some((item) => item.type !== "hidden") ?? false)
	);
</script>

{#if showPreferences && gameInfo}
	<div class="mt-3">
		<h3 class="flex items-center gap-1">
			Preferences
			{#if context.preferencesPage}
				<a href={resolve("/(app)/page/[part1]/[...part2]", { part1: gameInfo._id.game, part2: "preferences" })}>
					<IconInfoCircleFill class="text-xs" />
				</a>
			{/if}
		</h3>
		<PreferencesChooser game={gameInfo} />
	</div>
{/if}
