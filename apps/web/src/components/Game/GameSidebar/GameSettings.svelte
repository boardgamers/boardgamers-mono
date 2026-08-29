<script lang="ts">
	import { resolve } from "$app/paths";
	import SanitizedHtml from "../../SanitizedHtml.svelte";
	import { Checkbox, Label, Input, FormGroup } from "@/modules/cdk";
	import IconInfoCircleFill from "@/components/icons/IconInfoCircleFill.svelte";
	import { oneLineMarked } from "@/utils";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";
	import { getContext } from "svelte";
	import { account, live } from "@/lib/stores.svelte";
	import { post } from "@/lib/api";

	const context: GameContext = getContext("game");
	let game = $derived(context.game);
	let gameInfo = $derived(context.gameInfo);
	// SSR'd in the game page's load (player-scoped settings need the SSR `user`, which a
	// component can't read server-side — the `account` store is null there). Seeded into
	// the game context, so this renders on first paint with no post-hydration pop-in.
	let settings = $derived(context.settings);

	// `live`: the SSR user id during server render / first hydration, the live account
	// store after — so the Settings section SSRs (no flash) and stays correct client-side.
	let userId = $derived(live($account?._id ?? null, context.viewerUserId));
	let playerUser = $derived(game?.players.find((pl) => pl._id === userId));

	async function postSettings() {
		if (!game || !settings) {
			return;
		}
		await post(`/gameplay/${game._id}/settings`, settings as any);
	}
</script>

{#if game && gameInfo && (gameInfo.settings?.length ?? 0) > 0 && game.status === "active" && settings && playerUser}
	<div class="mt-3">
		<h3 class="flex items-center gap-1">
			Settings
			{#if context.settingsPage}
				<a href={resolve("/(app)/page/[part1]/[...part2]", { part1: game.game.name, part2: "settings" })}>
					<IconInfoCircleFill class="text-xs" />
				</a>
			{/if}
		</h3>
		<!-- Code very similar to PreferencesChooser -->
		{#each gameInfo.settings ?? [] as setting (setting.name)}
			{#if !setting.faction || setting.faction === playerUser.faction}
				{#if setting.type === "checkbox"}
					{@const settingName = setting.name}
					{@const settingsObj = settings}
					<Checkbox
						checked={(settingsObj[settingName] as boolean | undefined) ?? false}
						onchange={(e) => {
							settingsObj[settingName] = (e.target as HTMLInputElement).checked;
							postSettings();
						}}
					>
						{setting.label}
					</Checkbox>
				{:else if setting.type === "select"}
					<FormGroup class="flex items-center mt-2">
						<Label class="whitespace-nowrap me-2 mb-0"><SanitizedHtml html={oneLineMarked(setting.label)} /></Label>
						<Input type="select" bind:value={settings[setting.name]} onchange={postSettings} bsSize="sm">
							{#each setting.items as item (item.name)}
								<option value={item.name}>{item.label}</option>
							{/each}
						</Input>
					</FormGroup>
				{/if}
			{/if}
		{/each}
	</div>
{/if}
