<script lang="ts">
	import { resolve } from "$app/paths";
	import {
		timerTime,
		defer,
		duration,
		niceDate,
		shortDuration,
		compactDuration,
		timerWindow,
		type GamePace,
	} from "@/utils";
	import type { GameFront } from "@bgs/models";
	import { Badge, Pagination, Loading } from "@/modules/cdk";
	import IconClockHistory from "@/components/icons/IconClockHistory.svelte";
	import PlayerGameAvatar from "./PlayerGameAvatar.svelte";
	import SetupOptionBadge from "./SetupOptionBadge.svelte";
	import { logoClicks, logoClick } from "@/lib/stores.svelte";
	import IconDice from "@/components/icons/IconDice.svelte";
	import { useGameInfos, gameInfoKey } from "@/lib/game-info.svelte";
	import { gameBadge } from "@/utils/game-label";
	import { loadGames, type LoadGamesResult } from "@/lib/games.svelte";
	import { isPromise } from "@bgs/utils";
	import type { JsonObject } from "type-fest";

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
		pace = undefined,
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
		/** Live/async timing filter applied server-side (maps to a timePerGame bound). */
		pace?: GamePace | undefined;
		search?: string | undefined;
		// Applied to the outer wrapper (e.g. `min-w-0` so the list can shrink inside a
		// grid/flex cell instead of forcing the layout wide on mobile).
		class?: string;
	} = $props();

	let loadingGames = $state(true);
	let count = $state(0);
	let currentPage = $state(0);
	let games = $state<GameFront[]>([]);
	// Refreshed on each list (re)load so the relative-time labels ("last activity X
	// ago", "⏱ Xh left", "created X ago") recompute on a refresh; static between loads.
	let now = $state(Date.now());

	const load = defer(
		(refetchCount: boolean, bypassCache = false) => {
			// Sample lists also fetch the count: it's what powers the "N more open games"
			// discovery affordance (the sample itself is capped at perPage).
			const fetchCount = refetchCount && !topRecords;

			const result = loadGames({
				gameStatus,
				boardgameId,
				userId,
				sample,
				minDuration,
				maxDuration,
				pace,
				count: perPage,
				skip: currentPage * perPage,
				fetchCount,
				refresh: bypassCache,
				search,
			});

			const handleResult = (result: LoadGamesResult) => {
				now = Date.now();
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
		return gameBadge(gameInfos[gameInfoKey(name, "latest")]);
	}

	/** Game-specific setup options, keyed by option name (from the game's own options object). */
	function gameOptions(game: GameFront): JsonObject {
		return (game.game.options ?? {}) as JsonObject;
	}

	/** The setup options to badge on an open row: the game-info options this game set. */
	function setupOptions(game: GameFront) {
		const info = gameInfos[gameInfoKey(game.game.name, game.game.version)];
		const set = gameOptions(game);
		return (info?.options ?? []).filter((opt) => !!set[opt.name]);
	}

	// On narrow screens the avatar cluster would otherwise eat the name/timing
	// text — cap how many avatars are shown and collapse the rest into a "+k"
	// chip. CSS-based (max-width media query) so SSR/hydration agree.
	// 5 shrunk+overlapped avatars ≈ 4.4rem, still leaves room for the name/timing
	// text on a 390px-wide screen with a 6-player game.
	const MOBILE_AVATARS_LIMIT = 5;

	// lastMoveInfo.move is the engine's log line for the move (what the viewer
	// shows), falling back to raw move notation when the engine logged nothing —
	// e.g. an object-shaped move stringified. Raw object notation isn't readable in
	// a list row, so only surface plain-text lines. The mover's name is not shown
	// inline — it's in the chip's tooltip (see the template).
	function lastMoveText(game: GameFront): string | null {
		const move = game.lastMoveInfo?.move;
		if (!move || move.startsWith("{") || move.startsWith("[") || move.startsWith('"')) {
			return null;
		}
		return move;
	}

	function lastMovePlayer(game: GameFront): string {
		const id = game.lastMoveInfo?.player;
		return game.players.find((pl) => pl._id === id)?.name ?? "";
	}

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
		return Math.floor((Math.min(...deadlines) - now) / 1000);
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

	let firstRun = true;
	let lastLogoClicks = $logoClicks;
	let lastBoardgameId: string | undefined;
	let lastUserId: string | undefined | null;
	let lastPace: GamePace | undefined;
	let lastSearch: string | undefined;
	let lastPage = 0;

	// A single effect drives every (re)load, reacting to the filters/refresh trigger
	// (userId, boardgameId, search, $logoClicks) and to the page. Merging the two old
	// effects (filter watcher + page watcher) is what fixes the bug: with them separate,
	// navigating to a different boardgame while on a non-zero page fired *two* loads —
	// the filter effect's `load(true)` (games + count) and the page watcher's
	// `load(false)` (games only, `fetchCount:false`) — whose `games` overwrote the
	// correct one while `count` stayed stale. One effect means one `load(true)` at
	// page 0 for a filter change, refetching BOTH games and count.
	//
	// The effect reads `currentPage`, so the programmatic reset below re-runs it; that
	// re-run is made a harmless no-op by the `lastPage` tracker (the re-run sees
	// `pageChanged === false` and `filterChanged === false`).
	$effect(() => {
		userId;
		boardgameId;
		pace;
		search;
		const clicks = $logoClicks;
		const page = currentPage;

		// Skip the very first run — the initial load already happened synchronously above.
		// Seeding the change-trackers here (not at declaration) keeps them from
		// "capturing the initial prop value" (Svelte would warn) and matches the effect.
		if (firstRun) {
			firstRun = false;
			lastBoardgameId = boardgameId;
			lastUserId = userId;
			lastPace = pace;
			lastSearch = search;
			lastPage = page;
			return;
		}

		// A logo-click bump is a user-triggered refresh: bypass the games cache.
		// Filter changes keep the cache (switching back to a seen filter is instant).
		const isLogoRefresh = clicks !== lastLogoClicks;
		const filterChanged =
			boardgameId !== lastBoardgameId ||
			userId !== lastUserId ||
			pace !== lastPace ||
			search !== lastSearch ||
			isLogoRefresh;
		const pageChanged = page !== lastPage;
		lastLogoClicks = clicks;

		if (filterChanged) {
			// Reset to page 0 and refetch games + count for the new filter. Setting
			// lastPage = 0 (the page we're resetting TO) is what makes the reset's effect
			// re-run a no-op: it's subscribed to currentPage, so the `currentPage = 0`
			// write re-runs this effect, but then sees page===lastPage===0 and
			// filterChanged===false (the trackers were already advanced) → no second load.
			lastBoardgameId = boardgameId;
			lastUserId = userId;
			lastPace = pace;
			lastSearch = search;
			lastPage = 0;
			currentPage = 0;
			load(true, isLogoRefresh);
		} else if (pageChanged) {
			// Only the page changed: fetch the new page without a redundant count.
			lastPage = page;
			load(false);
		}
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
						{@const lastMove = game.status === "active" ? lastMoveText(game) : null}
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

								<!-- Left block claims the free width (flex-1) but can shrink (min-w-0); the
								     name is the only child allowed to truncate, so the elo chip and the avatar
								     stack always keep their room on long names. -->
								<div class="me-auto min-w-0 flex-1" style="line-height: 1.1">
									{#if game.status === "open"}
										<!-- Open row (#55): ONE wrapping line — seats chip, name, clock, then the
									     setup-option/restriction badges flow right after instead of stacking on
									     their own lines. No "created X ago" (dropped entirely). -->
										{@const meta = game.options.meta}
										{@const opts = setupOptions(game)}
										<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
											<span
												class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/60 dark:text-blue-200"
											>
												{game.players.length}/{game.options.setup.nbPlayers}
											</span>
											<span class="game-name min-w-0 truncate">
												{game._id}
											</span>
											<small
												class="flex shrink-0 items-center gap-1 whitespace-nowrap text-gray-500 dark:text-gray-400"
												title={`${playTime(game)} ${duration(game.options.timing.timePerGame ?? 0)} + ${duration(
													game.options.timing.timePerMove ?? 0
												)} · ${timerWindow(game.options.timing.timer)}`}
											>
												<IconClockHistory class="text-[0.8em]" />
												{compactDuration(game.options.timing.timePerGame ?? 0)}+{compactDuration(
													game.options.timing.timePerMove ?? 0
												)}
												{#if game.options.timing.scheduledStart}
													· starts on {niceDate(game.options.timing.scheduledStart)} at
													{new Date(game.options.timing.scheduledStart)
														.getHours()
														.toString()
														.padStart(2, "0")}h{new Date(game.options.timing.scheduledStart)
														.getMinutes()
														.toString()
														.padStart(2, "0")}
												{/if}
											</small>
											<!-- Setup options + join restrictions at a glance: see what you're joining
										     (and its requirements) without opening the game. -->
											{#each opts as pref (pref.name)}
												<SetupOptionBadge {pref} value={gameOptions(game)[pref.name]} />
											{/each}
											{#if meta?.minimumKarma !== undefined}
												<Badge color="secondary" class="setup-badge" title="Minimum karma to join"
													>☯️ {meta.minimumKarma}+ karma</Badge
												>
											{/if}
											{#if meta?.eloRange}
												<Badge color="secondary" class="setup-badge" title="Elo range required to join"
													>📈 {meta.eloRange.min}–{meta.eloRange.max} elo</Badge
												>
											{/if}
										</div>
									{:else}
										<!-- Active/ended rows: stacked name line + info line. -->
										<div class="flex items-center">
											{#if game.status === "active"}
												<Badge color="contrast" class="me-2 text-xs text-white">R{game.context?.round ?? 0}</Badge>
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
											class="flex items-center gap-1 text-xs"
											title={`${playTime(game)} ${duration(game.options.timing.timePerGame ?? 0)} + ${duration(
												game.options.timing.timePerMove ?? 0
											)} · ${timerWindow(game.options.timing.timer)}`}
										>
											{#if game.status === "ended"}
												<span class="text-gray-500 dark:text-gray-400">finished · {niceDate(game.lastMove ?? "")}</span>
											{:else}
												<!-- Ongoing games: last activity first, then time left on the current turn
											     when the game has a per-turn clock (full timing on hover) -->
												<span
													class="flex shrink-0 items-center gap-1 whitespace-nowrap text-gray-500 dark:text-gray-400"
												>
													<IconClockHistory class="text-[0.8em]" />
													{lastActivity(game)} ago
												</span>
												{#if timeLeft !== null}
													<span
														class="flex shrink-0 items-center gap-0.5 whitespace-nowrap {turnUrgent(game, timeLeft)
															? 'font-semibold text-amber-600 dark:text-amber-400'
															: 'text-gray-500 dark:text-gray-400'}"
													>
														· ⏱ {timeLeft <= 0 ? "overdue" : `${compactDuration(timeLeft)} left`}
													</span>
												{/if}
												{#if lastMove}
													<!-- Non-mobile only (#208): hidden on small screens (see .last-move). A
												     distinct pill so it doesn't blend into the italic timing text. -->
													<span
														class="last-move inline-flex min-w-0 max-w-56 items-center rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
														title="{lastMovePlayer(game)}: {lastMove}"
													>
														<span class="truncate">{lastMove}</span>
													</span>
												{/if}
											{/if}
										</small>
									{/if}
								</div>

								{#if game.status !== "open"}
									<!-- shrink-0: never clipped on long game names — the truncating name yields first. -->
									<div class="factions flex min-w-0 shrink-0 flex-row items-center">
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
								{/if}
							</a>
						</li>
					{/each}
				</ul>
				{#if sample && count > games.length}
					<!-- Lobby discovery: the sample is capped at perPage but the lobby holds
					     more — say so, offer the full list, and a dice re-roll for a fresh sample
					     (logoClick bumps $logoClicks, which this list reacts to with a cache
					     bypass; the server $sample then deals different games). -->
					<div class="mt-2 flex items-center justify-end gap-1 text-sm">
						<a
							href={resolve("/(app)/games")}
							class="rounded px-2 py-1 font-medium text-accent hover:bg-gray-100 hover:underline dark:text-accent-lighter dark:hover:bg-gray-800"
						>
							{count - games.length} more open {count - games.length === 1 ? "game" : "games"} →
						</a>
						<button
							type="button"
							class="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-accent dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-accent-lighter"
							title="Show a different random sample of open games"
							aria-label="Shuffle the sample of open games"
							onclick={() => logoClick()}
						>
							<IconDice />
						</button>
					</div>
				{:else if !topRecords && !sample && count > perPage}
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

	/* Last-move pill (#208): non-mobile only; it truncates instead of squeezing
	   the activity/clock labels (which stay nowrap + shrink-0). */
	@media (max-width: 639.98px) {
		.game-list .game-item .last-move {
			display: none;
		}
	}
</style>
