<script lang="ts">
  import type { PlayerInfoFront } from "@bgs/models";
  import { classnames, handleError } from "@/utils";
  import { account } from "@/lib/stores.svelte";
  import { loadGameInfo, gameInfo, gameInfos } from "@/lib/game-info.svelte";
  import { browser } from "$app/environment";

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

  $effect(() => {
    browser && game && !gameInfo(game) && loadGameInfo(game).catch(handleError);
  });

  let highlightedPlayerId = $derived(userId ?? $account?._id);

  let style = $derived(
    `background-image: url('${
      player.faction && gameInfo(game)?.factions?.avatars
        ? `/images/factions/icons/${player.faction}.svg`
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

<style lang="postcss">
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

    &.currentTurn {
      .vp {
        background-color: var(--accent);
      }
    }

    .vp {
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

      &.online {
        background-color: #25ee25;
      }

      &.away {
        background-color: orange;
      }
    }

    &.current {
      border: 2px solid #333;

      .vp {
        background-color: #6673bc;
      }
    }
  }
</style>
