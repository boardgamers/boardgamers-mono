<script lang="ts">
	import { resolve } from "$app/paths";
	import SanitizedHtml from "../SanitizedHtml.svelte";
	import {
		duration,
		handleError,
		niceDate,
		oneLineMarked,
		timerTimeInTz,
		confirm,
		createWatcher,
		defer,
	} from "@/utils";
	import { viewerTimezone } from "@/lib/timezone";
	import marked from "marked";
	import { Badge, Button, Dropdown, DropdownItem, DropdownMenu, DropdownToggle, FormGroup, Input } from "@/modules/cdk";
	import IconClockHistory from "@/components/icons/IconClockHistory.svelte";
	import IconList from "@/components/icons/IconList.svelte";
	import IconHourglass from "@/components/icons/IconHourglass.svelte";
	import UserAvatar from "@/components/User/UserAvatar.svelte";
	import UsernameLink from "@/components/User/UsernameLink.svelte";
	import GameName from "@/components/GameName.svelte";
	import SetupOptionBadge, { isNonDefaultSetupOption } from "./SetupOptionBadge.svelte";
	import IconArrowDown from "@/components/icons/IconArrowDown.svelte";
	import IconArrowUp from "@/components/icons/IconArrowUp.svelte";
	import { getContext, untrack } from "svelte";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";
	import { playerOrderText } from "@/data/playerOrders";
	import { account as user } from "@/lib/account.svelte";
	import { lastGameUpdate } from "@/lib/stores.svelte";
	import { get, post } from "@/lib/api";
	import { loadGame, loadGamePlayers } from "@/lib/game.svelte";
	import { goto } from "$app/navigation";
	import { loginRedirectQuery } from "@/utils/redirect";
	import { page } from "$app/state";
	import type { UserFront } from "@bgs/models";
	import type { JsonObject, JsonValue } from "type-fest";
	import { debounce } from "lodash";
	import { m, language } from "@/lib/i18n/messages";

	const context = getContext("game") as GameContext;
	let timer = $derived(context.game?.options.timing.timer);
	let gameId = $derived(context.game?._id);

	/** Game-specific options, keyed by option name. */
	const gameOptions = (game: { game: { options?: unknown } } | null | undefined): JsonObject =>
		(game?.game.options ?? {}) as JsonObject;

	// Viewer's timezone (context, init-only) — SSR renders the same local times
	// the client hydrates with (#339).
	const tz = viewerTimezone();

	const playTime = () => {
		if (timer?.start !== undefined) {
			return m.openGame_activeBetween({
				start: timerTimeInTz(timer.start, tz),
				end: timerTimeInTz(timer.end, tz),
				tz,
			});
		} else {
			return m.openGame_alwaysActive();
		}
	};

	const leave = async () => {
		if (await confirm(m.openGame_leaveConfirm())) {
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
			if (!(await confirm(m.openGame_shortDurationWarning()))) {
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

	let manualStart = $derived(!!context.game?.options.meta?.manualStart);

	// Manual-start games can begin below capacity when the boardgame supports the
	// current player count (e.g. 3 joined players in a 2-4 player game).
	let canStartEarly = $derived(
		Boolean(
			context.game &&
			manualStart &&
			!context.game.ready &&
			$user?._id === context.game.creator &&
			context.game.players.length < context.game.options.setup.nbPlayers &&
			!context.game.players.some((pl) => pl.pending) &&
			context.gameInfo?.players.includes(context.game.players.length)
		)
	);

	const kick = async (player: { _id: string; name: string }) => {
		if (!gameId || !(await confirm(m.openGame_kickConfirm({ name: player.name })))) {
			return;
		}
		try {
			await post(`/game/${gameId}/kick/${player._id}`);
			const [g, p] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);
			if (g._id === context.game?._id) {
				context.game = g;
				context.players = p;
			}
		} catch (err) {
			handleError(err);
		}
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
		// Strictly newer push ⇔ we're stale. Strict `>` and `untrack` both keep the
		// refetch from re-triggering this effect.
		const game = untrack(() => context.game);
		if (game && $lastGameUpdate > new Date(game.updatedAt)) {
			const [g, p] = await Promise.all([loadGame(game._id), loadGamePlayers(game._id)]);

			if (g._id === context.game?._id) {
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

<div class="container mx-auto px-4 pt-3 pb-3">
	<!-- Header: boardgame name, status, seats, host, and the host's own description -->
	<div class="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="mb-0"><GameName info={context.gameInfo} /></h1>
		<span
			class="rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"
		>
			{m.openGame_openGame()}
		</span>
		<span class="text-sm text-gray-500 dark:text-gray-400">
			{m.openGame_seatsFilled({
				filled: context.game?.players.length ?? 0,
				total: context.game?.options.setup.nbPlayers ?? 0,
			})}
		</span>
	</div>
	<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
		{m.openGame_hostedBy()}
		<UsernameLink
			username={context.players.find((pl) => pl._id === context.game?.creator)?.name ?? "?"}
			userId={context.game?.creator}
		/>
		·
		<a href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: context.gameInfo?._id.game ?? "" })}
			>{m.openGame_aboutGame()}</a
		>
		·
		<a href={resolve("/(app)/boardgame/[boardgameId]/new-game", { boardgameId: context.gameInfo?._id.game ?? "" })}
			>{m.openGame_createNew()}</a
		>
	</p>

	{#if context.game?.description}
		<div
			class="prose dark:prose-invert mb-4 max-w-2xl rounded-lg border border-primary/30 bg-primary/5 p-4 dark:bg-primary/10"
		>
			<SanitizedHtml html={marked(context.game.description)} />
		</div>
	{/if}

	<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
		<div class="flex flex-col gap-4">
			<!-- Game setup: timing, join restrictions, setup options -->
			<section class="rounded-lg border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-800/50">
				<h3
					class="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
				>
					<IconHourglass />
					{m.openGame_gameSetup()}
				</h3>
				<ul class="space-y-1.5 text-sm">
					<li>
						<b>{duration(context.game?.options.timing.timePerGame ?? 0)}</b>
						{m.openGame_perPlayer()},
						<b>+{duration(context.game?.options.timing.timePerMove ?? 0)}</b>
						{m.openGame_perMove()}
					</li>
					<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
						<IconClockHistory class="text-gray-400" />
						<span title={m.openGame_timezone()}>{m.openGame_clockRuns({ window: playTime() })}</span>
					</li>
					{#if context.game?.options.setup.seed}
						<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
							<span title={m.openGame_seed()}>🌱 {context.game.options.setup.seed}</span>
						</li>
					{/if}
					{#if typeof context.game?.options.meta?.minimumKarma === "number"}
						<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
							<span title={m.openGame_minKarma()}
								>☯️ {m.openGame_requiresKarma({ karma: context.game.options.meta.minimumKarma })}</span
							>
						</li>
					{/if}
					{#if context.game?.options.meta?.eloRange}
						<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
							<span title={m.openGame_eloRange()}
								>📈 {m.openGame_eloBetween({
									min: context.game.options.meta.eloRange.min,
									max: context.game.options.meta.eloRange.max,
								})}</span
							>
						</li>
					{/if}
					{#if manualStart}
						<li class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
							<span>🚦 {m.openGame_manualStart()}</span>
						</li>
					{/if}
					{#if context.game?.options.timing.scheduledStart}
						<li class="font-medium">
							{m.openGame_scheduledStart({
								date: niceDate(context.game.options.timing.scheduledStart),
								time: new Date(context.game.options.timing.scheduledStart).toLocaleTimeString($language),
							})}
						</li>
					{/if}
				</ul>

				<div class="mt-3 flex flex-wrap gap-1">
					<Badge color="secondary" class="setup-badge"
						>{playerOrderText(context.game?.options.setup.playerOrder ?? "random")}</Badge
					>
					{#each (context.gameInfo?.options ?? []).filter( (x) => isNonDefaultSetupOption(x, gameOptions(context.game)[x.name]) ) as pref (pref.name)}
						<SetupOptionBadge {pref} value={gameOptions(context.game)[pref.name]} />
					{/each}
					{#each context.game?.game.expansions ?? [] as expansion, i (i)}
						<Badge color="info"
							><SanitizedHtml
								html={oneLineMarked(context.gameInfo?.expansions?.find((xp) => xp.name === expansion)?.label ?? "")}
							/></Badge
						>
					{/each}
				</div>
			</section>

			<!-- About the boardgame: its description + rules links -->
			{#if context.gameInfo?.description || context.gameInfo?.rules}
				<section class="rounded-lg border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-800/50">
					<h3
						class="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
					>
						<IconList />
						{m.openGame_aboutRules()}
					</h3>
					{#if context.gameInfo?.description}
						<div class="prose prose-sm dark:prose-invert max-w-none">
							<SanitizedHtml html={marked(context.gameInfo.description)} />
						</div>
					{/if}
					{#if context.gameInfo?.rules}
						<div class="prose prose-sm dark:prose-invert mt-2 max-w-none">
							<SanitizedHtml html={marked(context.gameInfo.rules)} />
						</div>
					{/if}
				</section>
			{/if}
		</div>

		<!-- Players + status -->
		<section class="rounded-lg border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-800/50">
			<h3 class="mb-3">
				{m.openGame_players()}
				<span class="ml-1 text-base font-normal text-gray-500 dark:text-gray-400">
					{context.game?.players.length ?? 0} / {context.game?.options.setup.nbPlayers ?? 0}
				</span>
			</h3>

			{#if context.game && context.game.players.length > 0}
				<ul class="mb-3 space-y-2">
					{#each context.game.players as player (player._id)}
						{@const info = context.players.find((pl) => pl._id === player._id)}
						<li class="flex items-center gap-2">
							{#if player.isBot}
								<span
									class="flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700"
									style="height: 2rem; width: 2rem"
									title={player.name}>🤖</span
								>
								<span class="font-medium">{player.name}</span>
								<span
									class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
									title={m.openGame_botTitle()}>{m.openGame_bot()}</span
								>
							{:else}
								<UserAvatar userId={player._id} username={info?.name ?? "?"} size="2rem" />
								<UsernameLink username={info?.name ?? "?"} userId={player._id} class="font-medium" />
								<span class="text-sm text-gray-500 dark:text-gray-400">{info?.elo} elo</span>
								{#if typeof info?.karma === "number"}
									<span class="text-sm text-gray-500 dark:text-gray-400" title="Karma">☯️ {info.karma}</span>
								{/if}
							{/if}
							{#if player.pending}
								<span
									class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
									>{m.openGame_invited()}</span
								>
							{/if}
							{#if player._id === context.game?.creator}
								<span class="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary dark:text-primary-lighter"
									>{m.openGame_host()}</span
								>
							{/if}
							{#if $user?._id === context.game?.creator && !context.game?.ready && player._id !== context.game?.creator && !player.isBot}
								<button
									type="button"
									class="ml-auto rounded-full px-2 py-0.5 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40 dark:hover:text-red-400"
									title={m.openGame_kick({ name: player.name })}
									aria-label={m.openGame_kick({ name: player.name })}
									onclick={() => kick(player)}>✕</button
								>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if context.game && context.game.options.setup.nbPlayers > context.game.players.length}
				{@const missing = context.game.options.setup.nbPlayers - context.game.players.length}
				<p class="mb-3 text-sm text-gray-600 dark:text-gray-300">
					⏳ {m.openGame_waitingPlayers({
						count: `${missing} ${missing === 1 ? m.openGame_morePlayers() : m.openGame_morePlayers_plural()}`,
					})}
				</p>
				{#if $user?._id === context.game.creator && (1 || context.game.options.timing.scheduledStart)}
					<FormGroup>
						<label for="invite">{m.openGame_invitePlayer()}</label>
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
				{#if canStartEarly && context.game}
					<div class="mb-3">
						<Button color="primary" onclick={start}
							>{m.openGame_startWithCount({ count: context.game.players.length })}</Button
						>
					</div>
				{/if}
			{:else if context.game && !context.game.ready}
				{#if $user?._id === context.game.creator && !context.game.players.some((p) => p.pending)}
					{#if context.game.options.setup.playerOrder === "host"}
						<h3>{m.openGame_selectOrder()}</h3>
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
						<Button color="primary" onclick={start} class="mt-4">{m.openGame_start()}</Button>
					{:else if manualStart}
						<Button color="primary" onclick={start}>{m.openGame_start()}</Button>
					{/if}
				{:else if context.game.players.some((p) => p.pending)}
					<p class="text-sm text-gray-600 dark:text-gray-300">{m.openGame_waitingInvitations()}</p>
				{:else if manualStart}
					<p class="text-sm"><b>{m.openGame_waitingHostStart()}</b></p>
				{:else}
					<p class="text-sm"><b>{m.openGame_waitingHost()}</b></p>
				{/if}
			{:else if context.game?.options.timing.scheduledStart}
				<p class="text-sm text-gray-600 dark:text-gray-300">{m.openGame_waitingScheduled()}</p>
			{/if}

			{#if !canStart && context.game}
				<div class="mt-3 flex gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
					{#if context.game.players.some((pl) => pl._id === $user?._id)}
						{#if context.game.players.find((pl) => pl._id === $user?._id)?.pending}
							<Button color="accent" onclick={join}>{m.openGame_acceptInvitation()}</Button>
							<Button color="secondary" onclick={leave}>{m.openGame_refuseInvitation()}</Button>
						{:else}
							<Button color="warning" onclick={leave}>{m.openGame_leave()}</Button>
						{/if}
					{:else}
						<Button color="accent" onclick={join}>{m.openGame_join()}</Button>
					{/if}
				</div>
			{/if}
		</section>
	</div>
</div>
