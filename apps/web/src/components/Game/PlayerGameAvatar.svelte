<script lang="ts">
	import type { PlayerInfoFront } from "@bgs/models";
	import { classnames } from "@/utils";
	import { account } from "@/lib/stores.svelte";
	import { gameInfoKey, useGameInfos } from "@/lib/game-info.svelte";

	let {
		player,
		showVp = true,
		game,
		status = "",
		class: className = "",
		userId,
		isCurrent,
	}: {
		player: PlayerInfoFront;
		showVp?: boolean;
		game: string;
		status?: string;
		class?: string;
		userId?: string | undefined;
		isCurrent?: boolean | undefined;
	} = $props();

	let highlightedPlayerId = $derived(userId ?? $account?._id);

	const infos = useGameInfos();
	let bg = $derived(infos[gameInfoKey(game, "latest")]);
	let style = $derived(
		`background-image: url('${
			player.faction && bg?.factions?.avatars
				? `/images/factions/icons/${player.faction}.svg`
				: player.isBot
					? // Bots have no user account — the id route would 404; byName serves a generated avatar.
						`/api/user/byName/${encodeURIComponent(player.name)}/avatar`
					: `/api/user/${player._id}/avatar?d=${$account?.account.avatar}`
		}')`
	);
</script>

<div
	{style}
	title={player.name}
	class={classnames("player-avatar", className)}
	class:current={highlightedPlayerId && player._id === highlightedPlayerId}
	class:currentTurn={isCurrent}
>
	{#if showVp}
		<span class={`vp ${status}`}>{player.score}</span>
	{/if}
</div>

<style>
	.player-avatar {
		height: 2rem;
		width: 2rem;
		min-width: 2rem;
		min-height: 2rem;
		display: inline-flex;
		position: relative;
		border-radius: 50%;
		background-size: cover;
		align-items: center;
		justify-content: space-around;
		font-weight: bold;
	}

	.player-avatar.currentTurn .vp {
		background-color: var(--color-accent, #508f16);
	}

	.player-avatar .vp {
		position: absolute;
		right: -5px;
		bottom: -5px;
		font-size: 0.7rem;
		border-radius: 5px;
		color: white;
		background-color: #838383;
		width: 20px;
		font-weight: normal;
		text-align: center;
	}

	.player-avatar .vp.online {
		background-color: #25ee25;
	}

	.player-avatar .vp.away {
		background-color: orange;
	}

	.player-avatar.current {
		border: 2px solid #333;
	}

	:global(.dark) .player-avatar.current {
		border-color: rgb(229 231 235); /* gray-200 — visible on dark bg */
	}

	.player-avatar.current .vp {
		background-color: #6673bc;
	}
</style>
