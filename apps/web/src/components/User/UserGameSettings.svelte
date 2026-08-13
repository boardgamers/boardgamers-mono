<script lang="ts">
	import { set } from "lodash";
	import { untrack } from "svelte";
	import { get as getStore } from "svelte/store";
	import type { GameInfoFront } from "@bgs/models";
	import { handleError, confirm, classnames, createWatcher } from "@/utils";
	import Card from "@/modules/cdk/Card.svelte";
	import { CardText, FormGroup, Input } from "@/modules/cdk";
	import Checkbox from "@/modules/cdk/Checkbox.svelte";
	import Loading from "@/modules/cdk/Loading.svelte";
	import PreferencesChooser from "./PreferencesChooser.svelte";
	import IconCart from "../icons/IconCart.svelte";
	import { post } from "@/lib/api";
	import { gameInfoKey } from "@/lib/game-info.svelte";
	import { gameDisplayName } from "@/utils/game-label";
	import { developerSettings, devGameSettings } from "@/lib/stores.svelte";
	import { gamePreferences, useGamePreferencesFallback } from "@/lib/game-preferences.svelte";

	let {
		title = "",
		game,
		class: className = "",
	}: {
		title?: string;
		game: GameInfoFront;
		class?: string;
	} = $props();

	const ssrPrefs = useGamePreferencesFallback();
	let prefs = $derived($gamePreferences[game._id.game] ?? ssrPrefs[game._id.game]);

	let ownership = $state(
		untrack(() => ($gamePreferences[game._id.game] ?? ssrPrefs[game._id.game])?.access?.ownership ?? false)
	);

	// Only react to subsequent store changes — the initial value was already seeded above.
	const syncOwnership = createWatcher(() => {
		ownership = prefs?.access?.ownership ?? false;
	});
	$effect(() => {
		prefs;
		syncOwnership();
	});

	async function postOwnership(event: Event) {
		const newVal = (event.target! as HTMLInputElement).checked;

		if (newVal) {
			const res = await confirm(
				"I certify on my honor that I own a copy of the game",
				game.links?.buy ? { url: game.links.buy, label: "Buy a copy" } : undefined
			);

			if (!res) {
				ownership = false;
				(event.target! as HTMLInputElement).checked = false;
				return;
			}
		}

		try {
			await post(`/account/games/${game._id.game}/ownership`, {
				access: { ...prefs.access, ownership: newVal },
			});
			prefs.access = { ...prefs.access, ownership: newVal };
		} catch (err) {
			handleError(err);
		}
	}

	let classes = $derived(classnames(className, "border-gray-400 dark:border-gray-600"));

	let key = $derived(gameInfoKey(game._id.game, game._id.version));

	let customViewerUrl = $state("");

	// One-way sync: seed customViewerUrl from devGameSettings when key changes.
	// Uses untrack to avoid re-triggering the save effect below.
	$effect(() => {
		key;
		customViewerUrl = untrack(() => $devGameSettings[key]?.viewerUrl ?? "");
	});

	// Save: when user types in the input, persist to devGameSettings.
	// untrack prevents the devGameSettings write from re-triggering this effect.
	function onViewerUrlInput() {
		set($devGameSettings, `${key}.viewerUrl`, customViewerUrl);
		$devGameSettings = { ...$devGameSettings };
	}
</script>

<Card class={classes} header={title || gameDisplayName(game)}>
	<CardText class="h-full flex flex-col">
		<Loading loading={!prefs}>
			<div class="grow space-y-3">
				<div class="flex items-center gap-2 rounded-lg bg-accent/10 p-3 dark:bg-accent/20">
					<Checkbox checked={ownership} onchange={postOwnership} class="text-base font-semibold" />
					<span class="text-base font-semibold">I own this game</span>
					{#if game.links?.buy}
						<a
							href={game.links.buy}
							target="_blank"
							rel="external noopener noreferrer"
							class="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold no-underline"
						>
							<IconCart />
							Buy
						</a>
					{/if}
				</div>
				{#if (game.preferences?.length ?? 0) > 0}
					<hr class="border-gray-200 dark:border-gray-700" />
					<div class="space-y-2">
						<PreferencesChooser {game} framed />
					</div>
				{/if}
			</div>
			{#if $developerSettings}
				<hr class="mt-3 border-gray-200 dark:border-gray-700" />
				<FormGroup>
					<label for="viewerUrl">Custom Viewer URL ({key})</label>
					<Input type="text" placeholder="Viewer URL" bind:value={customViewerUrl} onchange={onViewerUrlInput} />
				</FormGroup>
			{/if}
		</Loading>
	</CardText>
</Card>
