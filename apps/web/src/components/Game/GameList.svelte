<script lang="ts">
	import { resolve } from "$app/paths";
	import { timerTime, defer, duration, niceDate, shortDuration, compactDuration, timerWindow } from "@/utils";
	import type { GameFront } from "@bgs/models";
	import { createWatcher } from "@/utils/watch";
	import { Badge, Pagination, Loading } from "@/modules/cdk";
	import IconClockHistory from "@/components/icons/IconClockHistory.svelte";
	import PlayerGameAvatar from "./PlayerGameAvatar.svelte";
	import { logoClicks } from "@/lib/stores.svelte";
	import { useGameInfos, gameInfoKey } from "@/lib/game-info.svelte";
	import { loadGames, type LoadGamesResult } from "@/lib/games.svelte";
	import { isPromise } from "@bgs/utils";

	let {
		title = "Games",
		perPage = 10,
		topRecords = false,
		sample = false,
		gameStatus,
		boardgameId = undefined,
		userId = undefined,
		minDuration = undefined,
		maxDuration = undefined,
		search = undefined,
		class: className = "",
	}: {
		title?: string;
		perPage?: number;
		topRecords?: boolean;
		sample?: boolean;
		gameStatus: GameFront["status"];
		boardgameId?: string | undefined;
		userId?: string | undefined | null;
		minDuration?: number | undefined;
		maxDuration?: number | undefined;
		search?: string | undefined;
		// Applied to the outer wrapper (e.g. `min-w-0` so the list can shrink inside a
		// grid/flex cell instead of forcing the layout wide on mobile).
		class?: string;
	} = $props();

	let loadingGames = $state(true);
	let count = $state(0);
	let currentPage = $state(0);
	let games = $state<GameFront[]>([]);

	const load = defer(
		(refresh: boolean) => {
			const fetchCount = refresh && !topRecords && !sample;

			const result = loadGames({
				gameStatus,
				boardgameId,
				userId,
				sample,
				minDuration,
				maxDuration,
				count: perPage,
				skip: currentPage * perPage,
				fetchCount,
				search,
			});

			const handleResult = (result: LoadGamesResult) => {
				games = result.games;

				if (fetchCount) {
					count = result.total;
				}
			};

			// We don't want to be a promise if not needed, for SSR
			if (!isPromise(result)) {
				return handleResult(result);
			} else {
				return result.then(handleResult);
			}
		},
		() => (loadingGames = false)
	);

	// Initial load: run synchronously during component init so SSR has data.
	load(true);

	function playerEloChange(game: GameFront) {
		const pl = game.players.find((pl) => pl._id === userId);

		if (!pl || !pl.elo) {
			return;
		}

		const elo = pl.elo.initial ?? 0;
		const delta = pl.elo.delta ?? 0;
		if (elo === 0 && delta === 0) {
			return "";
		}
		// The proper minus sign (not a hyphen) keeps the chip compact and unambiguous.
		const text = (delta >= 0 ? "+" : "−") + Math.abs(delta);
		return { delta, text, label: `Elo change: ${text}` };
	}

	function playTime(game: GameFront) {
		if (game.options.timing.timer?.start !== game.options.timing.timer?.end) {
			return `${timerTime(game.options.timing.timer?.start ?? 0)}-${timerTime(game.options.timing.timer?.end ?? 0)}`;
		} else {
			return "24h";
		}
	}

	const gameInfos = useGameInfos();
	function gameIcon(name: string) {
		const game = gameInfos[gameInfoKey(name, "latest")];

		return game?.label.trim().slice(0, game?.label.trim().indexOf(" "));
	}

	// On narrow screens the avatar cluster would otherwise eat the name/timing
	// text — cap how many avatars are shown and collapse the rest into a "+k"
	// chip. CSS-based (max-width media query) so SSR/hydration agree.
	// 5 shrunk+overlapped avatars ≈ 4.4rem, still leaves room for the name/timing
	// text on a 390px-wide screen with a 6-player game.
	const MOBILE_AVATARS_LIMIT = 5;

	// No live re-render: "⏱ Xh left" / "last activity" are computed once per load
	// and go stale while the list stays open. Revisit with a 1s ticker (cheap but
	// re-renders constantly) or backend-pushed refreshes.
	const now = Date.now();

	// lastMove/createdAt are optional — fall back to "just now" when both are missing.
	function lastActivity(game: GameFront): string {
		const ts = new Date(game.lastMove ?? game.createdAt ?? now).getTime() || now;
		return shortDuration(Math.max(30, Math.floor((now - ts) / 1000))) ?? "";
	}

	// Time left on the current turn (seconds), from the per-player deadline the API
	// already sends on the list payload. Prefers the viewer's own deadline; otherwise
	// the earliest current player's. Negative when the deadline has passed. Null when
	// the game has no per-turn clock.
	function turnTimeLeft(game: GameFront): number | null {
		const current = game.currentPlayers ?? [];
		const own = userId ? current.find((pl) => pl._id === userId) : undefined;
		const candidates = own ? [own] : current;
		const deadlines = candidates.filter((pl) => pl.deadline).map((pl) => new Date(pl.deadline!).getTime());
		if (deadlines.length === 0) {
			return null;
		}
		return Math.floor((Math.min(...deadlines) - Date.now()) / 1000);
	}

	// "Act soon": it's the viewer's turn and the turn deadline is close. Only when
	// timePerMove is set — the deadline derives from the remaining *game* clock, so
	// without a per-move budget we can't tell a genuine "about to time out" from a
	// long game that's simply past 3/4 of its total clock.
	function turnUrgent(game: GameFront, secondsLeft: number): boolean {
		const timePerMove = game.options.timing.timePerMove;
		if (!userId || !timePerMove || !game.currentPlayers?.some((pl) => pl._id === userId)) {
			return false;
		}
		return secondsLeft <= timePerMove / 4;
	}

	const onCurrentPageChanged = createWatcher(() => load(false));

	let firstRun = true;

	$effect(() => {
		userId;
		boardgameId;
		search;
		$logoClicks;
		// Skip the first run — initial load already happened synchronously above.
		if (firstRun) {
			firstRun = false;
			return;
		}
		// Reset to the first page when the filter changes.
		currentPage = 0;
		load(true);
	});

	$effect(() => {
		currentPage;
		onCurrentPageChanged();
	});
</script>

<div class={className}>
	<Loading loading={loadingGames}>
		<h3 class="font-semibold">
			{title}
			{#if !topRecords && !sample}
				<span class="text-xs">({count})</span>
			{/if}
		</h3>
		<div>
			{#if games.length > 0}
				<ul
					class="divide-y divide-accent/80 rounded-lg border border-accent/80 bg-white text-start dark:divide-accent/60 dark:border-accent/60 dark:bg-gray-900 game-list"
				>
					{#each games as game (game._id)}
						{@const timeLeft = game.status === "active" ? turnTimeLeft(game) : null}
						{@const eloChange = playerEloChange(game)}
						<li
							class="game-item"
							class:active-game={game.status === "active"}
							class:current-turn={game.currentPlayers?.some((pl) => pl._id === userId)}
							class:turn-urgent={timeLeft !== null && turnUrgent(game, timeLeft)}
						>
							<a
								href={resolve("/game/[gameId]", { gameId: game._id })}
								class="no-link flex w-full cursor-pointer items-center px-4 py-2 pe-1 ps-0 hover:bg-gray-50 dark:hover:bg-gray-800"
							>
								<span class="game-kind mx-3">
									{gameIcon(game.game.name)}
								</span>

								<div class="me-auto min-w-0" style="line-height: 1.1">
									<div class="flex items-center">
										{#if game.status === "active"}
											<Badge color="contrast" class="me-2 text-xs text-white">R{game.context?.round ?? 0}</Badge>
										{:else if game.status === "open"}
											<span
												class="me-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/60 dark:text-blue-200"
											>
												{game.players.length}/{game.options.setup.nbPlayers}
											</span>
										{/if}
										<span class="game-name min-w-0 truncate">
											{game._id}
										</span>
										{#if eloChange}
											<!-- shrink-0 + whitespace-nowrap: the chip never wraps or gets squeezed, so the
											     name truncates before it instead of overlapping on narrow screens. -->
											<span
												class="ms-1.5 inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-semibold {eloChange.delta >=
												0
													? 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200'
													: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200'}"
												title={eloChange.label}
												aria-label={eloChange.label}
											>
												{eloChange.text}
											</span>
										{/if}
									</div>
									<small
										class="flex items-center gap-1 whitespace-nowrap text-xs"
										title={`${playTime(game)} ${duration(game.options.timing.timePerGame ?? 0)} + ${duration(
											game.options.timing.timePerMove ?? 0
										)} · ${timerWindow(game.options.timing.timer)}`}
									>
										{#if game.status === "ended"}
											<span class="text-gray-500 dark:text-gray-400">finished · {niceDate(game.lastMove ?? "")}</span>
										{:else if game.status === "active"}
											<!-- Ongoing games: last activity first, then time left on the current turn
											     when the game has a per-turn clock (full timing on hover) -->
											<span class="flex items-center gap-1 text-gray-500 dark:text-gray-400">
												<IconClockHistory class="text-[0.8em]" />
												{lastActivity(game)} ago
											</span>
											{#if timeLeft !== null}
												<span
													class="flex items-center gap-0.5 {turnUrgent(game, timeLeft)
														? 'font-semibold text-amber-600 dark:text-amber-400'
														: 'text-gray-500 dark:text-gray-400'}"
												>
													· ⏱ {timeLeft <= 0 ? "overdue" : `${compactDuration(timeLeft)} left`}
												</span>
											{/if}
										{:else}
											<IconClockHistory class="text-[0.8em]" />
											{compactDuration(game.options.timing.timePerGame ?? 0)}+{compactDuration(
												game.options.timing.timePerMove ?? 0
											)}
											{#if game.options.timing.scheduledStart}
												· starts on {niceDate(game.options.timing.scheduledStart)} at
												{new Date(game.options.timing.scheduledStart)
													.getHours()
													.toString()
													.padStart(2, "0")}}h{new Date(game.options.timing.scheduledStart)
													.getMinutes()
													.toString()
													.padStart(2, "0")}
											{/if}
										{/if}
									</small>
								</div>

								{#if game.status !== "open"}
									<div class="factions flex min-w-0 shrink flex-row items-center">
										{#each game.players as player, i (player._id)}
											<PlayerGameAvatar
												game={game.game.name}
												isCurrent={game.currentPlayers?.some((pl) => pl._id === player._id)}
												userId={userId ?? undefined}
												{player}
												class={i >= MOBILE_AVATARS_LIMIT ? "mobile-hidden-avatar me-1" : "me-1"}
											/>
										{/each}
										{#if game.players.length > MOBILE_AVATARS_LIMIT}
											<span
												class="mobile-avatar-more shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400"
												title="{game.players.length - MOBILE_AVATARS_LIMIT} more players"
												aria-label="{game.players.length - MOBILE_AVATARS_LIMIT} more players"
											>
												+{game.players.length - MOBILE_AVATARS_LIMIT}
											</span>
										{/if}
									</div>
								{:else}
									<div class="me-3 text-right" style="line-height: 1.1;">
										<small class="text-gray-500 dark:text-gray-400">
											{shortDuration(Math.floor((Date.now() - new Date(game.createdAt ?? "").getTime()) / 1000))} ago
										</small>
									</div>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
				{#if !topRecords && count > perPage}
					<Pagination {count} {perPage} bind:currentPage align="right" class="mt-2" />
				{/if}
			{:else}
				<p>No games to show</p>
			{/if}
		</div>
	</Loading>
</div>

<style>
	.game-list .game-item {
		display: flex;
		align-items: center;
	}

	.game-list .game-item.current-turn {
		background: lightgreen;
	}

	/* Dark mode: keep the "your turn" signal but with a dark-mode-appropriate tint. */
	:global(.dark) .game-list .game-item.current-turn {
		background: rgb(34 84 24 / 0.55); /* dark green tint, readable with light text */
	}

	.game-list .game-item.current-turn:hover,
	.game-list .game-item.current-turn:focus {
		filter: brightness(95%);
	}

	:global(.dark) .game-list .game-item.current-turn:hover,
	:global(.dark) .game-list .game-item.current-turn:focus {
		filter: brightness(115%);
	}

	.game-list .game-item.current-turn:active {
		filter: brightness(90%);
	}

	/* On mobile, if multiple lines, I want items to be aligned to the right */
	.game-list .game-item.active-game .factions {
		justify-content: flex-end;
	}

	/* Mobile (#163): with ~6 players the avatars used to take their full width and
	   squeeze the name/timing text to nothing. Cap the cluster at the first few
	   avatars (rest collapse into a "+k" chip), shrink and overlap them a bit. */
	@media (max-width: 639.98px) {
		.game-list .game-item .factions {
			flex-wrap: nowrap;
		}

		/* :global: svelte-check can't see the class on the child component's root node */
		.game-list .game-item .factions :global(.player-avatar.mobile-hidden-avatar) {
			display: none;
		}

		.game-list .game-item .factions .mobile-avatar-more {
			display: inline;
		}

		.game-list .game-item .factions :global(.player-avatar) {
			width: 1.5rem;
			height: 1.5rem;
			min-width: 1.5rem;
			min-height: 1.5rem;
		}

		.game-list .game-item .factions :global(.player-avatar) + :global(.player-avatar) {
			margin-inline-start: -0.35rem;
		}

		.game-list .game-item .factions :global(.player-avatar) {
			box-shadow: 0 0 0 1.5px white;
		}

		:global(.dark) .game-list .game-item .factions :global(.player-avatar) {
			box-shadow: 0 0 0 1.5px #111827; /* gray-900, the list's dark background */
		}

		.game-list .game-item .factions :global(.player-avatar .vp) {
			font-size: 0.55rem;
			width: 15px;
			right: -4px;
			bottom: -4px;
		}
	}

	@media (min-width: 640px) {
		.game-list .game-item .factions .mobile-avatar-more {
			display: none;
		}
	}

	/* Mobile: "act soon" — your turn and the turn deadline is close. Amber left
	   border, distinct from the green current-turn background. */
	@media (max-width: 639.98px) {
		.game-list .game-item.turn-urgent {
			border-inline-start: 3px solid rgb(217 119 6); /* amber-600 */
		}

		:global(.dark) .game-list .game-item.turn-urgent {
			border-inline-start-color: rgb(251 191 36); /* amber-400 */
		}
	}

	.game-list .game-item .game-kind {
		font-size: 1.8em;
	}
</style>
