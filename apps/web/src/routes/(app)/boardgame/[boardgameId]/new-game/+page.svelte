<script lang="ts">
	import { handleError, oneLineMarked, duration } from "@/utils";
	import marked from "marked";
	import { fromPairs } from "lodash";
	import { Button, Input, Checkbox } from "@/modules/cdk";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import SanitizedHtml from "@/components/SanitizedHtml.svelte";
	import GameName from "@/components/GameName.svelte";
	import { randomGameName } from "@/data";
	import { fade } from "svelte/transition";
	import { untrack } from "svelte";
	import { browser } from "$app/environment";
	import type { PlayerOrder } from "@bgs/models";
	import { playerOrders } from "@/data/playerOrders";
	import { account } from "@/lib/account.svelte";
	import { live } from "@/lib/stores.svelte";
	import type { UserFront } from "@bgs/models";
	import { useLoggedIn } from "@/lib/auth-guards.svelte";
	import { post } from "@/lib/api";
	import { useGameInfos, gameInfoKey } from "@/lib/game-info.svelte";
	import { useGamePreferencesFallback, gamePreferences } from "@/lib/game-preferences.svelte";
	import { developerSettings } from "@/lib/stores.svelte";
	import { page } from "$app/state";
	import TimeRangeSlider from "@/components/Form/TimeRangeSlider.svelte";
	import { m } from "@/lib/i18n/messages";

	useLoggedIn();

	// SSR renders the snapshot; the client trusts the seeded account store (see stores.svelte.ts).
	let karma = $derived(live($account, (page.data.user as UserFront | null) ?? null)?.account.karma ?? 80);

	let boardgameId = $derived(page.params.boardgameId); // Can be undefined during page navigation out
	// Game-info list comes from the root-provided context: a reactive `$state` map, so
	// reads inside `$derived` track it.
	const infos = useGameInfos();
	let info = $derived(boardgameId ? infos[gameInfoKey(boardgameId, "latest")] : undefined);

	let gameId = $state(randomId());
	let showAdvanced = $state(false);
	let description = $state("");
	let seed = $state("");
	let numPlayers = $state(2);
	let numBots = $state(0);
	let options = $state(["join"]);
	// A game must seat at least one human. The creator takes a seat only when the
	// "join" option is on, so without it the cap is players - 2 (a seat must stay
	// open for a human joiner) instead of players - 1.
	let maxBots = $derived(Math.max(0, numPlayers - (options.includes("join") ? 1 : 2)));
	// Bots are dumb (engine auto-play) and only for testing the UI solo — the picker
	// is a developer-only control, hidden unless developer settings are enabled.
	let botsSupported = $derived(!!info?.meta?.bots && $developerSettings);
	let playerOrder = $state<PlayerOrder>("random");
	let selects = $state<Record<string, string>>({});
	let expansions = $state<string[]>([]);

	// Remember the last-used setup per boardgame in a cookie, so the form can render
	// the saved options during SSR (no defaults→saved flash). Only non-secret fields.
	let lastSetup = $derived(page.data.lastSetup as Record<string, any> | null);

	function saveLastSetup() {
		if (!browser || !boardgameId) return;
		try {
			const value = JSON.stringify({ options, playerOrder, selects, expansions, numPlayers, timePerMove, timePerGame });
			document.cookie = `new-game-setup:${boardgameId}=${encodeURIComponent(value)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
		} catch {
			// ignore storage errors
		}
	}

	let timePerMove = $state(2 * 3600);
	let timePerGame = $state(3 * 24 * 3600);
	let submitting = $state(false);
	let timerEnd = $state("22:00");
	let timerStart = $state("09:00");
	// Whether the daily overnight pause is active (mirrors timerStart !== timerEnd).
	let pauseOvernight = $state(true);

	let scheduledDay = $state(null as string | null);
	let scheduledTime = $state("");

	let enableKarma = $state(false);
	// Editable field seeded once from karma; untrack marks the one-time capture as intentional.
	let minimumKarma = $state(untrack(() => Math.min(75, karma - 5)));

	// Unrated players start at 0 elo.
	const ssrPrefs = useGamePreferencesFallback();
	let ownElo = $derived(
		boardgameId ? ($gamePreferences[boardgameId]?.elo?.value ?? ssrPrefs[boardgameId]?.elo?.value ?? 0) : 0
	);
	let enableEloRange = $state(false);
	let minElo = $state(untrack(() => Math.max(0, ownElo - 100)));
	let maxElo = $state(untrack(() => ownElo + 100));

	function createGame() {
		submitting = true;

		const dataObj = {
			game: {
				game: boardgameId,
				version: info?._id.version,
			},
			gameId,
			players: numPlayers,
			description: description.trim() ? description.trim() : (undefined as string | undefined),
			bots: numBots > 0 ? numBots : (undefined as number | undefined),
			timePerMove,
			timePerGame,
			options: { ...fromPairs(options.map((key) => [key, true])), ...selects, playerOrder },
			seed: seed as string | undefined,
			expansions,
			timerStart: undefined as number | undefined,
			timerEnd: undefined as number | undefined,
			scheduledStart: undefined as number | undefined,
			minimumKarma: +minimumKarma as number | undefined,
			eloRange: undefined as { min: number; max: number } | undefined,
		};

		if (scheduledDay && scheduledTime) {
			dataObj.scheduledStart = Date.parse(`${scheduledDay}T${scheduledTime}`);
		} else {
			delete dataObj.scheduledStart;
		}

		if (!seed) {
			delete dataObj.seed;
		}

		if (!dataObj.bots) {
			delete dataObj.bots;
		}

		if (!enableKarma || !dataObj.minimumKarma) {
			delete dataObj.minimumKarma;
		}

		if (enableEloRange) {
			dataObj.eloRange = { min: Math.floor(+minElo), max: Math.floor(+maxElo) };
		}

		if (timerStart === undefined || timerStart === timerEnd || timerEnd === undefined) {
			delete dataObj.timerStart;
			delete dataObj.timerEnd;
		} else {
			const toTime = (x: string) => {
				const hours = +x.slice(0, 2);
				const minutes = +x.slice(3, 5);

				return (hours * 3600 + minutes * 60 + new Date().getTimezoneOffset() * 60 + 24 * 3600) % (24 * 3600);
			};

			dataObj.timerStart = toTime(timerStart);
			dataObj.timerEnd = toTime(timerEnd);
		}

		post("/game/new-game", dataObj)
			.then(() => {
				saveLastSetup();
				goto(resolve("/game/[gameId]", { gameId }));
			}, handleError)
			.finally(() => (submitting = false));
	}

	$effect(() => {
		const sanitized = gameId.trim().replace(/ /g, "-");
		if (sanitized !== gameId) {
			gameId = sanitized;
		}
	});

	// Keep the bot count within the seats the player count leaves for bots.
	$effect(() => {
		if (numBots > maxBots) {
			numBots = maxBots;
		}
	});

	const updateSelects = async () => {
		if (!info) {
			return;
		}

		// Load default values for multiple choice options
		const newVal: Record<string, string> = {};

		for (const select of (info.options ?? []).filter((option) => option.type === "select")) {
			if (select.items) {
				newVal[select.name] =
					typeof select.default === "string" && select.items.some((item) => item.name === select.default)
						? select.default
						: select.items[0].name;
			}
		}

		for (const check of (info.options ?? []).filter((option) => option.type === "checkbox")) {
			if (check.default === true) {
				options.push(check.name);
			}
		}

		if (!info.players.includes(numPlayers)) {
			numPlayers = info.players[0];
		}

		if (!info.meta?.bots) {
			numBots = 0;
		}

		selects = newVal;
	};

	// Apply the user's saved setup on top of the defaults (one shot, on first load).
	const applyLastSetup = () => {
		const last = lastSetup;
		if (!last) return;
		if (Array.isArray(last.options) && last.options.length) options = last.options;
		if (last.playerOrder) playerOrder = last.playerOrder;
		if (last.selects) selects = { ...selects, ...last.selects };
		if (Array.isArray(last.expansions)) expansions = last.expansions;
		if (last.numPlayers && info?.players.includes(last.numPlayers)) numPlayers = last.numPlayers;
		if (last.timePerMove) timePerMove = last.timePerMove;
		if (last.timePerGame) timePerGame = last.timePerGame;
	};

	// Initial load: run synchronously during component init so SSR has data, applying
	// defaults + saved setup in the same untracked pass so defaults never flash.
	if (untrack(() => info)) {
		untrack(() => {
			updateSelects();
			applyLastSetup();
		});
	}

	let appliedLastSetup = false;
	$effect(() => {
		if (!info) return;
		untrack(() => {
			updateSelects();
			if (!appliedLastSetup) {
				appliedLastSetup = true;
				applyLastSetup();
			}
		});
	});

	function randomId() {
		return randomGameName();
	}
</script>

{#if info}
	<div class="container mx-auto px-4">
		<h1 class="mb-2"><GameName {info} /></h1>
		<p class="mb-6 text-gray-500 dark:text-gray-400">
			{m.newGame_setup()}
		</p>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				createGame();
			}}
		>
			<!-- Essentials -->
			<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<div>
					<div class="mb-4">
						<span class="mb-1 block font-medium">{m.newGame_nbPlayers()}</span>
						<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.newGame_nbPlayers()}>
							{#each info.players as option, i (i)}
								<button
									type="button"
									class="rounded-md border px-4 py-2 text-sm font-medium transition-colors {numPlayers === option
										? 'border-primary bg-primary text-white'
										: 'border-gray-300 text-gray-700 hover:border-primary hover:text-primary dark:border-gray-600 dark:text-gray-200 dark:hover:text-primary-lighter'}"
									aria-pressed={numPlayers === option}
									onclick={() => (numPlayers = option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>

					{#if botsSupported}
						<div class="mb-4">
							<span class="mb-1 block font-medium">{m.newGame_botPlayers()}</span>
							<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.newGame_botPlayers()}>
								{#each Array.from({ length: maxBots + 1 }, (_, i) => i) as option (option)}
									<button
										type="button"
										class="rounded-md border px-4 py-2 text-sm font-medium transition-colors {numBots === option
											? 'border-primary bg-primary text-white'
											: 'border-gray-300 text-gray-700 hover:border-primary hover:text-primary dark:border-gray-600 dark:text-gray-200 dark:hover:text-primary-lighter'}"
										aria-pressed={numBots === option}
										onclick={() => (numBots = option)}
									>
										{option === 0 ? m.newGame_noBots() : option}
									</button>
								{/each}
							</div>
							{#if numBots > 0}
								<p
									class="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
									transition:fade
								>
									{m.newGame_botsWarning()}
								</p>
							{/if}
						</div>
					{/if}

					<div class="mb-4">
						<label for="gameId" class="mb-1 block font-medium">{m.newGame_gameName()}</label>
						<input
							class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
							id="gameId"
							type="text"
							maxlength="25"
							name="gameId"
							bind:value={gameId}
							placeholder={m.newGame_gameIdPlaceholder()}
							aria-label={m.newGame_gameIdPlaceholder()}
							required
						/>
						<small class="text-xs text-gray-500 dark:text-gray-400">{m.newGame_gameNameHelp()}</small>
					</div>

					<div class="mb-4">
						<label for="description" class="mb-1 block font-medium"
							>{m.newGame_description()}
							<span class="font-normal text-gray-500 dark:text-gray-400">{m.common_optional()}</span></label
						>
						<Input
							type="textarea"
							id="description"
							maxlength="1000"
							rows="3"
							bind:value={description}
							placeholder={m.newGame_descriptionPlaceholder()}
						/>
						<small class="text-xs text-gray-500 dark:text-gray-400">{m.newGame_descriptionHelp()}</small>
					</div>

					<!-- Important game selects (map / variant / etc.) promoted out of Advanced -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{#each (info.options ?? []).filter((opt) => opt.type === "select") as select (select.name)}
							<div>
								<label for={select.name} class="mb-1 block font-medium"
									><SanitizedHtml html={oneLineMarked(select.label)} /></label
								>
								<Input type="select" bind:value={selects[select.name]} id={select.name} required>
									{#each select.items || [] as item (item.name)}
										<option value={item.name}>{marked(item.label).replace(/<[^>]+>/g, "")}</option>
									{/each}
								</Input>
							</div>
						{/each}
					</div>

					{#if (info.expansions ?? []).length > 0}
						<div class="mt-4">
							<h3>{m.newGame_expansions()}</h3>
							<div class="flex flex-wrap gap-2">
								{#each info.expansions ?? [] as expansion (expansion.name)}
									<label
										class="cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium transition-colors {expansions.includes(
											expansion.name
										)
											? 'border-accent bg-accent text-white'
											: 'border-gray-300 text-gray-700 hover:border-accent hover:text-accent dark:border-gray-600 dark:text-gray-200 dark:hover:text-accent-lighter'}"
									>
										<input type="checkbox" class="sr-only" bind:group={expansions} value={expansion.name} />
										<SanitizedHtml html={oneLineMarked(expansion.label)} />
									</label>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- Game options as toggle chips -->
				<div>
					<span class="mb-1 block font-medium">{m.newGame_options()}</span>
					<div class="flex flex-wrap gap-2">
						<label
							class="cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {options.includes(
								'join'
							)
								? 'border-primary bg-primary text-white'
								: 'border-gray-300 text-gray-700 hover:border-primary hover:text-primary dark:border-gray-600 dark:text-gray-200 dark:hover:text-primary-lighter'}"
						>
							<input type="checkbox" class="sr-only" bind:group={options} value="join" />
							{m.newGame_joinAsPlayer()}
						</label>
						<label
							class="cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {options.includes(
								'unlisted'
							)
								? 'border-primary bg-primary text-white'
								: 'border-gray-300 text-gray-700 hover:border-primary hover:text-primary dark:border-gray-600 dark:text-gray-200 dark:hover:text-primary-lighter'}"
						>
							<input type="checkbox" class="sr-only" bind:group={options} value="unlisted" />
							{m.newGame_unlisted()}
						</label>
						{#each (info.options ?? []).filter((opt) => opt.type === "checkbox") as option (option.name)}
							<label
								class="cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {options.includes(
									option.name
								)
									? 'border-primary bg-primary text-white'
									: 'border-gray-300 text-gray-700 hover:border-primary hover:text-primary dark:border-gray-600 dark:text-gray-200 dark:hover:text-primary-lighter'}"
							>
								<input type="checkbox" class="sr-only" bind:group={options} value={option.name} />
								<SanitizedHtml html={oneLineMarked(option.label)} />
							</label>
						{/each}
					</div>
				</div>
			</div>

			<!-- Timing -->
			<h3 class="mt-4">{m.newGame_timing()}</h3>
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

			<!-- Subtle note about the daily timer window (lives in Advanced) -->
			<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
				{#if pauseOvernight}
					{m.newGame_clockWindow({ start: timerStart, end: timerEnd })}
				{:else}
					{m.newGame_clockContinuous()}
				{/if}
				<button
					type="button"
					class="underline decoration-dotted underline-offset-2 hover:text-primary dark:hover:text-primary-lighter"
					onclick={() => {
						showAdvanced = true;
						setTimeout(
							() => document.getElementById("timerEnd")?.scrollIntoView({ behavior: "smooth", block: "center" }),
							50
						);
					}}>{m.newGame_edit()}</button
				>
			</p>

			{#if !scheduledDay || !scheduledTime}
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-400" transition:fade>
					{m.newGame_cancelNotice({
						delay:
							timePerGame <= 600
								? m.newGame_cancelDelay_hour()
								: timePerGame <= 3600
									? m.newGame_cancelDelay_threeHours()
									: m.newGame_cancelDelay_week(),
					})}
				</p>
			{/if}

			<!-- Advanced options (collapsed) -->
			<div class="mt-4 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
				<button
					type="button"
					class="flex w-full items-center justify-between px-3 py-2 text-left font-semibold hover:bg-gray-50 dark:hover:bg-gray-800"
					aria-expanded={showAdvanced}
					onclick={() => (showAdvanced = !showAdvanced)}
				>
					{m.newGame_advanced()}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						width="1em"
						height="1em"
						fill="currentColor"
						class="shrink-0 transition-transform {showAdvanced ? 'rotate-180' : ''}"
					>
						<path
							fill-rule="evenodd"
							d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"
						/>
					</svg>
				</button>

				{#if showAdvanced}
					<div class="space-y-4 border-t border-gray-200 px-3 py-4 dark:border-gray-700">
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label for="playerOrder">{m.newGame_playerOrder()}</label>
								<Input type="select" bind:value={playerOrder} id="playerOrder" required>
									{#each playerOrders as item (item.name)}
										<option value={item.name}>{item.label}</option>
									{/each}
								</Input>
							</div>

							<div>
								<label for="seed">{m.newGame_customSeed()}</label>
								<input
									class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
									id="seed"
									type="text"
									maxlength="25"
									bind:value={seed}
									placeholder={m.newGame_seedPlaceholder()}
									aria-label={m.newGame_seedPlaceholder()}
								/>
								<small class="text-xs text-gray-500 dark:text-gray-400">{m.newGame_seedHelp()}</small>
							</div>
						</div>

						<div>
							<Checkbox bind:checked={enableKarma}>{m.newGame_restrictKarma()}</Checkbox>
							<div class="mt-2 max-w-xs">
								<Input
									type="number"
									disabled={!enableKarma}
									placeholder={m.newGame_minKarmaPlaceholder()}
									bind:value={minimumKarma}
									max={karma - 5}
								/>
							</div>
						</div>

						<div>
							<Checkbox bind:checked={enableEloRange}>{m.newGame_restrictElo()}</Checkbox>
							<div class="mt-2 flex max-w-xs items-center gap-2">
								<Input
									type="number"
									disabled={!enableEloRange}
									placeholder={m.newGame_minElo()}
									bind:value={minElo}
									min={0}
								/>
								<span>–</span>
								<Input
									type="number"
									disabled={!enableEloRange}
									placeholder={m.newGame_maxElo()}
									bind:value={maxElo}
									min={0}
								/>
							</div>
							<small class="text-xs text-gray-500 dark:text-gray-400">
								{m.newGame_eloRangeHelp({ elo: ownElo })}
							</small>
						</div>

						<fieldset>
							<legend class="mb-2 font-medium">{m.newGame_scheduledStart()}</legend>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<div>
									<label for="scheduledDate">{m.newGame_day()}</label>
									<input
										type="date"
										class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
										bind:value={scheduledDay}
										id="scheduledDate"
									/>
								</div>
								<div>
									<label for="scheduledTime">{m.newGame_time()}</label>
									<input
										type="time"
										class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
										bind:value={scheduledTime}
										id="scheduledTime"
									/>
								</div>
							</div>
							<small class="text-xs text-gray-500 dark:text-gray-400">{m.newGame_scheduledHelp()}</small>
						</fieldset>

						<fieldset>
							<legend class="mb-2 font-medium">{m.newGame_timerWindow()}</legend>
							<div class="mb-3">
								<Checkbox
									checked={pauseOvernight}
									onchange={(e) => {
										pauseOvernight = (e.target as HTMLInputElement).checked;
										if (!pauseOvernight) {
											timerStart = timerEnd; // disables the daily pause
										} else {
											timerStart = "09:00";
											timerEnd = "22:00";
										}
									}}
								>
									{m.newGame_pauseOvernight()}
								</Checkbox>
							</div>

							{#if pauseOvernight}
								<div class="mt-2">
									<TimeRangeSlider bind:start={timerStart} bind:end={timerEnd} />
								</div>
							{/if}
						</fieldset>
					</div>
				{/if}
			</div>

			<div class="mt-5 flex items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
				<Button type="submit" color="primary" disabled={submitting}>{m.newGame_create()}</Button>
			</div>
		</form>
	</div>
{/if}
