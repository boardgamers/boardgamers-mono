<script lang="ts">
	import { browser } from "$app/environment";
	import { keyBy } from "lodash";
	import { elapsedSeconds } from "@bgs/utils";
	import { timerTime, oneLineMarked, handleError, confirm, duration, shortDuration } from "@/utils";
	import type { PlayerInfoFront } from "@bgs/models";
	import type { JsonObject, JsonValue } from "type-fest";
	import { Button, Badge } from "@/modules/cdk";
	import IconClockHistory from "@/components/icons/IconClockHistory.svelte";
	import { getContext, onDestroy } from "svelte";
	import { GameLog, ReplayControls, GameNotes, GamePreferences, GameSettings } from "./GameSidebar";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";
	import PlayerGameAvatar from "./PlayerGameAvatar.svelte";
	import UsernameLink from "@/components/User/UsernameLink.svelte";
	import SetupOptionBadge from "./SetupOptionBadge.svelte";
	import SanitizedHtml from "../SanitizedHtml.svelte";
	import { post } from "@/lib/api";
	import { account } from "@/lib/account.svelte";
	import { playerStatus, addActiveGame, removeActiveGame, devGameSettings } from "@/lib/stores.svelte";

	const context: GameContext = getContext("game");
	let game = $derived(context.game);
	let players = $derived(context.players);
	let gameInfo = $derived(context.gameInfo);

	let secondsCounter = $state(0);

	const interval = setInterval(() => {
		if (browser && !document.hidden) {
			secondsCounter += 1;
		}
	}, 1000);
	onDestroy(() => clearInterval(interval));

	let requestedDrop = $state<Record<string, boolean>>({});

	let userId = $derived($account?._id);
	let playerUser = $derived(game?.players.find((pl) => pl._id === userId));
	let gameId = $derived(game?._id);

	function status(playerId: string) {
		return $playerStatus?.find((pl) => pl._id === playerId)?.status ?? "offline";
	}

	function playerElo(playerId: string) {
		return players.find((pl) => pl._id === playerId)?.elo ?? 0;
	}

	let alwaysActive = $derived(game?.options.timing.timer?.start === game?.options.timing.timer?.end);

	let currentPlayersById = $derived(keyBy(game?.currentPlayers ?? [], "_id"));

	function isCurrentPlayer(id: string) {
		return game?.status !== "ended" && !!currentPlayersById[id];
	}

	/** Game-specific options, keyed by option name. */
	const gameOptions = (): JsonObject => (game?.game.options ?? {}) as JsonObject;

	const onGameChanged = () => {
		if (userId && gameId) {
			if (isCurrentPlayer(userId)) {
				addActiveGame(gameId);
			} else {
				removeActiveGame(gameId);
			}
		}
	};

	$effect(() => {
		userId;
		game;
		onGameChanged();
	});

	let remainingTimes = $derived.by(() => {
		if (!game) return {};
		const ret: Record<string, number> = {};
		for (const player of game.players) {
			ret[player._id] = remainingTime(player);
		}
		return ret;
	});

	function remainingTime(player: PlayerInfoFront) {
		const currentPlayer = currentPlayersById[player._id];
		if (currentPlayer) {
			const spent = elapsedSeconds(new Date(currentPlayer.timerStart as any), game?.options.timing.timer);
			// Trick to update every second
			return Math.max((player.remainingTime ?? 0) - spent, 0) + (secondsCounter % 1);
		}
		return Math.max(player.remainingTime ?? 0, 0);
	}

	async function voteCancel() {
		if (
			await confirm("This vote cannot be taken back. If all active players vote to cancel, the game will be cancelled.")
		) {
			await post(`/game/${gameId}/cancel`).catch(handleError);
		}
	}

	async function quit() {
		await post(`/game/${gameId}/quit`).catch(handleError);
	}

	async function requestDrop(playerId: string) {
		await post(`/game/${gameId}/drop/${playerId}`).then(
			() => (requestedDrop = { ...requestedDrop, [playerId]: true }),
			handleError
		);
	}
</script>

<div id="floating-controls"></div>
{#if game && gameInfo}
	<h3 class="mt-3">Players</h3>
	{#each game.players as player (player._id)}
		<div class="mb-1 flex items-center player-row" class:active={isCurrentPlayer(player._id)}>
			<PlayerGameAvatar game={game.game.name} {userId} {player} status={status(player._id)} class="me-2" />

			<div>
				<UsernameLink
					username={player.name}
					userId={player._id}
					class={player.dropped ? "player-name dropped" : "player-name"}
				/>
				<sup class="ms-1">
					{#if player.elo}
						{player.elo.initial} {(player.elo.delta ?? 0) >= 0 ? "+" : "-"} {Math.abs(player.elo.delta ?? 0)} elo
					{:else}
						{playerElo(player._id)} elo
					{/if}
				</sup>
				{#if game.status === "active"}
					<span class="ms-1"> - {shortDuration(remainingTimes[player._id])}</span>
				{/if}
			</div>
		</div>
	{/each}
	<div class="mt-3 flex items-center">
		<IconClockHistory class="me-1" />
		<span>
			{alwaysActive
				? "24h"
				: `${timerTime(game.options.timing.timer?.start ?? 0)}-${timerTime(game.options.timing.timer?.end ?? 0)}`}
			/ {duration(game.options.timing.timePerGame ?? 0)} + {duration(game.options.timing.timePerMove ?? 0)}
		</span>
	</div>
	{#if game.status === "ended"}
		<div class="mt-3">
			<b> Game ended! </b>
		</div>
	{/if}
	{#key game.currentPlayers}
		{#if userId && isCurrentPlayer(userId)}
			<div class="mt-3">
				<b class="your-turn">Your turn!</b>
			</div>
		{/if}
	{/key}
	{#if playerUser && game.status !== "ended"}
		<div class="mt-3">
			<Button
				color="warning"
				size="sm"
				disabled={playerUser.dropped || playerUser.voteCancel || playerUser.quit}
				onclick={voteCancel}
			>
				Vote to cancel
			</Button>
			{#if game.players.some((pl) => !!pl.dropped)}
				<Button size="sm" class="ms-2" disabled={playerUser.dropped || playerUser.quit} onclick={quit}>Quit</Button>
			{/if}
			{#each game.players as player (player._id)}
				{#if remainingTime(player) <= 0 && isCurrentPlayer(player._id) && !player.dropped && !player.quit}
					<Button
						size="sm"
						class="ms-2"
						color="danger"
						disabled={requestedDrop[player._id]}
						onclick={() => requestDrop(player._id)}
					>
						Drop {player.name}
					</Button>
				{/if}
			{/each}
		</div>
	{/if}

	<GameSettings />

	<GamePreferences />

	<GameNotes gameId={gameId ?? ""} />

	{#if (game.game.expansions?.length ?? 0) > 0}
		<div class="mt-3">
			<h3>Expansions</h3>
			{#each game.game.expansions as expansion, i (i)}
				<Badge color="accent" class="me-1">
					<SanitizedHtml html={oneLineMarked(gameInfo.expansions?.find((xp) => xp.name === expansion)?.label ?? "")} />
				</Badge>
			{/each}
		</div>
	{/if}

	<GameLog />

	<ReplayControls />

	{#if (gameInfo.options ?? []).some((x) => !!gameOptions()[x.name])}
		<div class="mt-3">
			<h3 class="mb-1">Setup options</h3>
			<div class="flex flex-wrap gap-1">
				{#each (gameInfo.options ?? []).filter((x) => !!gameOptions()[x.name]) as pref (pref.name)}
					<SetupOptionBadge {pref} value={gameOptions()[pref.name]} />
				{/each}
			</div>
		</div>
	{/if}
	<div class="my-3"></div>
	{#if $devGameSettings}
		<a target="_blank" rel="external" href={`/api/gameplay/${game._id}`}>Download JSON</a>
	{/if}
{/if}
