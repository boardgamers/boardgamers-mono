<script lang="ts">
	import { resolve } from "$app/paths";
	import SanitizedHtml from "../SanitizedHtml.svelte";
	import {
		duration,
		handleError,
		niceDate,
		oneLineMarked,
		pluralize,
		timerTime,
		confirm,
		localTimezone,
		createWatcher,
		defer,
	} from "@/utils";
	import marked from "marked";
	import { Badge, Button, Dropdown, DropdownItem, DropdownMenu, DropdownToggle, FormGroup, Input } from "@/modules/cdk";
	import IconClockHistory from "@/components/icons/IconClockHistory.svelte";
	import IconList from "@/components/icons/IconList.svelte";
	import IconPerson from "@/components/icons/IconPerson.svelte";
	import IconHourglass from "@/components/icons/IconHourglass.svelte";
	import UserAvatar from "@/components/User/UserAvatar.svelte";
	import UsernameLink from "@/components/User/UsernameLink.svelte";
	import SetupOptionBadge from "./SetupOptionBadge.svelte";
	import IconArrowDown from "@/components/icons/IconArrowDown.svelte";
	import IconArrowUp from "@/components/icons/IconArrowUp.svelte";
	import { getContext } from "svelte";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";
	import { playerOrderText } from "@/data/playerOrders";
	import { account as user } from "@/lib/account.svelte";
	import { lastGameUpdate } from "@/lib/stores.svelte";
	import { get, post } from "@/lib/api";
	import { loadGame, loadGamePlayers } from "@/lib/game.svelte";
	import { goto } from "$app/navigation";
	import { loginRedirectQuery } from "@/utils/redirect";
	import { page } from "$app/state";
	import SEO from "../SEO.svelte";
	import removeMarkdown from "remove-markdown";
	import { gameLabel } from "@/utils/game-label";
	import type { UserFront } from "@bgs/models";
	import type { JsonObject, JsonValue } from "type-fest";
	import { debounce } from "lodash";

	const context = getContext("game") as GameContext;
	let timer = $derived(context.game?.options.timing.timer);
	let gameId = $derived(context.game?._id);

	/** Game-specific options, keyed by option name. */
	const gameOptions = (game: { game: { options?: unknown } } | null | undefined): JsonObject =>
		(game?.game.options ?? {}) as JsonObject;

	const shortPlayTime = () => {
		if (timer?.start !== timer?.end) {
			return `${timerTime(timer?.start ?? 0)}-${timerTime(timer?.end ?? 0)}`;
		} else {
			return "24h";
		}
	};

	const playTime = () => {
		if (timer?.start !== undefined) {
			return `active between ${timerTime(timer.start)} and ${timerTime(
				timer.end
			)}, in your local time (${localTimezone()})`;
		} else {
			return "always active";
		}
	};

	const leave = async () => {
		if (await confirm("Are you sure you want to leave this game?")) {
			post(`/game/${gameId}/unjoin`).then(() => goto(resolve("/(app)")), handleError);
		}
	};

	const join = async () => {
		if (!$user) {
			const loginTarget = resolve("/(app)/login") + loginRedirectQuery(page.url);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is resolve()d above; the rule can't trace resolve() + query-string concatenation
			goto(loginTarget);
			return;
		}

		if (context.game && (context.game.options.timing.timePerGame ?? Infinity) <= 24 * 3600) {
			if (
				!(await confirm(
					"This game has a short duration. You need to keep yourself available in order to play the game until the end."
				))
			) {
				return;
			}
		}

		post(`/game/${gameId}/join`).catch(handleError);
	};

	let playerOrder = $state<number[]>(context.game?.players.map((_, i) => i) ?? []);

	function refreshPlayerOrder() {
		if (context.game) {
			playerOrder = context.game.players.map((_, i) => i);
		}
	}

	$effect(() => {
		context.game;
		refreshPlayerOrder();
	});

	const moveUp = (playerId: number) => {
		const index = playerOrder.indexOf(playerId);

		if (index > 0) {
			const tmp = playerOrder[index - 1];
			playerOrder[index - 1] = playerOrder[index];
			playerOrder[index] = tmp;
			playerOrder = playerOrder;
		}
	};

	const moveDown = (playerId: number) => {
		const index = playerOrder.indexOf(playerId);

		if (index + 1 < playerOrder.length) {
			const tmp = playerOrder[index + 1];
			playerOrder[index + 1] = playerOrder[index];
			playerOrder[index] = tmp;
			playerOrder = playerOrder;
		}
	};

	let canStart = $derived(
		context.game
			? context.game.options.setup.nbPlayers === context.game.players.length &&
					!context.game.ready &&
					$user?._id === context.game.creator
			: false
	);

	const start = () => {
		post(`/game/${gameId}/start`, { playerOrder: playerOrder.map((x) => context.game?.players[x]._id) }).catch(
			handleError
		);
	};

	let isOpen = $state(false);

	let foundUsers = $state<UserFront[]>([]);
	let query = $state("");

	const invite = defer(async (userId: string, isName = false) => {
		if (isName) {
			const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(userId)}`);
			userId = user._id ?? "";
		}
		post(`/game/${gameId}/invite`, { userId });
	});

	const watcher = debounce(
		async () => {
			if (query) {
				foundUsers = (await get<UserFront[]>("/user/search", { name: query.trim() }).catch(handleError)) || [];
			} else {
				foundUsers = [];
			}
		},
		400,
		{ leading: false }
	);

	$effect(() => {
		query;
		watcher();
	});

	const updateGameWatcher = createWatcher(async () => {
		if (context.game && gameId && $lastGameUpdate > new Date(context.game.updatedAt ?? 0)) {
			const [g, p] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);

			if (context.game && gameId === g._id) {
				context.game = g;
				context.players = p;
			}
		}
	});

	// Autorefresh when another player joins
	$effect(() => {
		$lastGameUpdate;
		updateGameWatcher();
	});
</script>

<SEO
	title="{gameId} - {gameLabel(context.gameInfo?.label ?? '')} game"
	description="{context.game?.players.length} / {context.game?.options.setup.nbPlayers} players. Timer of {duration(
		context.game?.options.timing.timePerGame ?? 0
	)} per player, with an additional {duration(context.game?.options.timing.timePerMove ?? 0)} per move.
{(context.game?.game.expansions?.length ?? 0) > 0 &&
		`
      Expansions: ${context.game?.game.expansions.join(',')}\\n`}
{(context.gameInfo?.options ?? [])
		.filter((x) => !!gameOptions(context.game)[x.name])
		.map((pref) =>
			pref.type === 'checkbox'
				? pref.label
				: pref.type === 'select' && pref.items
					? pref.label + ': ' + pref.items.find((x) => x.name === gameOptions(context.game)[pref.name])?.label
					: ''
		)
		.filter(Boolean)
		.map((str) => `- ${removeMarkdown(str)}`)
		.join('\\n')}"
/>

<div class="container mx-auto px-4 pb-3">
	<!-- Title: boardgame link (breadcrumb-style) + status -->
	<div class="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="mb-0">{context.gameInfo?.label}</h1>
		<span
			class="rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"
		>
			Open game
		</span>
		<span class="text-sm text-gray-500 dark:text-gray-400">
			{context.game?.players.length ?? 0} / {context.game?.options.setup.nbPlayers ?? 0} seats filled
		</span>
	</div>
	<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
		<a href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: context.gameInfo?._id.game ?? "" })}
			>About the game</a
		>
		·
		<a href={resolve("/(app)/boardgame/[boardgameId]/new-game", { boardgameId: context.gameInfo?._id.game ?? "" })}
			>Create a new game</a
		>
	</p>

	<!-- Intro description (no heading — reads as lead copy) -->
	{#if context.gameInfo?.description}
		<div class="prose dark:prose-invert mb-5 max-w-2xl">
			<SanitizedHtml html={marked(context.gameInfo.description)} />
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
		<div>
			<h3
				class="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
			>
				<IconList /> About this game
			</h3>
			<ul class="space-y-1.5 text-sm">
				<li class="flex items-center gap-2">
					<IconPerson class="text-gray-400" />
					<span>
						Hosted by
						<UsernameLink
							username={context.players.find((pl) => pl._id === context.game?.creator)?.name ?? "?"}
							userId={context.game?.creator}
							class="font-medium"
						/>
					</span>
				</li>
				<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
					<IconClockHistory class="text-gray-400" />
					<span title="Timezone">Plays {shortPlayTime()}</span>
				</li>
				{#if context.game?.options.setup.seed}
					<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
						<span title="Game seed">🌱 {context.game.options.setup.seed}</span>
					</li>
				{/if}
				{#if typeof context.game?.options.meta?.minimumKarma === "number"}
					<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
						<span title="Minimum karma to join the game"
							>☯️ requires {context.game.options.meta.minimumKarma} karma</span
						>
					</li>
				{/if}
				{#if context.game?.options.meta?.eloRange}
					<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
						<span title="Elo range required to join the game"
							>📈 Elo between {context.game.options.meta.eloRange.min} and {context.game.options.meta.eloRange
								.max}</span
						>
					</li>
				{/if}
			</ul>

			{#if context.game?.options.timing.scheduledStart}
				<p class="mt-2 text-sm font-medium">
					Scheduled to start on {niceDate(context.game.options.timing.scheduledStart)} at
					{new Date(context.game.options.timing.scheduledStart).toLocaleTimeString("en")}
				</p>
			{/if}
		</div>

		<div>
			<h3
				class="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
			>
				<IconHourglass /> Timer
			</h3>
			<ul class="space-y-1.5 text-sm">
				<li>
					<b>{duration(context.game?.options.timing.timePerGame ?? 0)}</b> per player,
					<b>+{duration(context.game?.options.timing.timePerMove ?? 0)}</b> per move
				</li>
				<li class="text-gray-500 dark:text-gray-400">Clock runs {playTime()}</li>
			</ul>

			{#if context.gameInfo?.rules}
				<h4 class="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Rules</h4>
				<div class="prose prose-sm dark:prose-invert max-w-none">
					<SanitizedHtml html={marked(context.gameInfo.rules)} />
				</div>
			{/if}
		</div>
	</div>

	{#if (context.game?.game.expansions?.length ?? 0) > 0}
		<div class="mt-3">
			<h3>Expansions</h3>
			{#each context.game!.game.expansions as expansion, i (i)}
				<Badge color="info"
					><SanitizedHtml
						html={oneLineMarked(context.gameInfo?.expansions?.find((xp) => xp.name === expansion)?.label ?? "")}
					/></Badge
				>
			{/each}
		</div>
	{/if}

	<div class="mt-3">
		<h3>Setup options</h3>

		<div class="flex flex-wrap gap-1">
			<Badge color="secondary" class="setup-badge"
				>{playerOrderText(context.game?.options.setup.playerOrder ?? "random")}</Badge
			>
			{#each (context.gameInfo?.options ?? []).filter((x) => !!gameOptions(context.game)[x.name]) as pref (pref.name)}
				<SetupOptionBadge {pref} value={gameOptions(context.game)[pref.name]} />
			{/each}
		</div>
	</div>

	<!-- Players + status -->
	<div class="my-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-800/50">
		<h3 class="mb-3">
			Players
			<span class="ml-1 text-base font-normal text-gray-500 dark:text-gray-400">
				{context.game?.players.length ?? 0} / {context.game?.options.setup.nbPlayers ?? 0}
			</span>
		</h3>

		{#if context.game && context.game.players.length > 0}
			<ul class="mb-3 space-y-2">
				{#each context.game.players as player (player._id)}
					{@const info = context.players.find((pl) => pl._id === player._id)}
					<li class="flex items-center gap-2">
						<UserAvatar userId={player._id} username={info?.name ?? "?"} size="2rem" />
						<UsernameLink username={info?.name ?? "?"} userId={player._id} class="font-medium" />
						<span class="text-sm text-gray-500 dark:text-gray-400">{info?.elo} elo</span>
						{#if player.pending}
							<span
								class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
								>invited</span
							>
						{/if}
						{#if player._id === context.game?.creator}
							<span class="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary dark:text-primary-lighter"
								>host</span
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if context.game && context.game.options.setup.nbPlayers > context.game.players.length}
			<p class="mb-3 text-sm text-gray-600 dark:text-gray-300">
				⏳ Waiting on <b
					>{pluralize(context.game.options.setup.nbPlayers - context.game.players.length, "more player")}</b
				> to start.
			</p>
			{#if $user?._id === context.game.creator && (1 || context.game.options.timing.scheduledStart)}
				<FormGroup>
					<label for="invite">Invite player</label>
					<Dropdown isOpen={Boolean(isOpen && foundUsers.length)} toggle={() => (isOpen = !isOpen)}>
						<DropdownToggle tag="div" class="inline-block">
							<Input
								id="invite"
								bind:value={query}
								onkeydown={(e) => e.key === "Enter" && invite((e.target as HTMLInputElement).value, true)}
							/>
						</DropdownToggle>
						<DropdownMenu>
							{#each foundUsers as result (result._id)}
								<DropdownItem onclick={() => invite(result._id)}>{result.account.username}</DropdownItem>
							{/each}
						</DropdownMenu>
					</Dropdown>
				</FormGroup>
			{/if}
		{:else if context.game && !context.game.ready}
			{#if $user?._id === context.game.creator}
				{#if context.game.options.setup.playerOrder === "host"}
					<h3>Select player order</h3>
					{#each playerOrder as playerIndex, i (i)}
						<div>
							- {context.game.players[playerIndex].name}
							<span
								onclick={() => moveUp(playerIndex)}
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === "Enter" && moveUp(playerIndex)}><IconArrowUp /></span
							>
							<span
								onclick={() => moveDown(playerIndex)}
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === "Enter" && moveDown(playerIndex)}><IconArrowDown /></span
							>
						</div>
					{/each}
					<Button color="primary" onclick={start} class="mt-4">Start the game!</Button>
				{/if}
			{:else if context.game.players.some((p) => p.pending)}
				<p class="text-sm text-gray-600 dark:text-gray-300">Waiting on some players to accept the invitation.</p>
			{:else}
				<p class="text-sm"><b>Waiting on host for final settings</b></p>
			{/if}
		{:else if context.game?.options.timing.scheduledStart}
			<p class="text-sm text-gray-600 dark:text-gray-300">Waiting on scheduled start.</p>
		{/if}
	</div>

	{#if !canStart && context.game}
		<div class="flex gap-2">
			{#if context.game.players.some((pl) => pl._id === $user?._id)}
				{#if context.game.players.find((pl) => pl._id === $user?._id)?.pending}
					<Button color="accent" onclick={join}>Accept invitation</Button>
					<Button color="secondary" onclick={leave}>Refuse invitation</Button>
				{:else}
					<Button color="warning" onclick={leave}>Leave</Button>
				{/if}
			{:else}
				<Button color="accent" onclick={join}>Join!</Button>
			{/if}
		</div>
	{/if}
</div>
