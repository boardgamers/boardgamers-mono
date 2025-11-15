<script lang="ts">
  import type { PlayerInfo } from "@bgs/types";
  import { classnames, handleError } from "@/utils";
  import { useAccount } from "@/composition/useAccount";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { browser } from "$app/env";

  const { account } = useAccount();
  const { loadGameInfo, gameInfo, gameInfos } = useGameInfo();

  export let player: PlayerInfo;
  export let showVp = true;
  export let game: string;

  export let status = "";
  let className = "";
  export { className as class };

  export let userId: string | undefined;
  export let isCurrent: boolean | undefined;

  $: browser && game && !gameInfo(game) && loadGameInfo(game).catch(handleError);

  let style: string;

  $: highlightedPlayerId = userId ?? $account?._id;
  $: (style = `background-image: url('${
    player.faction && gameInfo(game)?.factions?.avatars
      ? `/images/factions/icons/${player.faction}.svg`
      : `/api/user/${player._id}/avatar?d=${$account?.account.avatar}`
  }')`),
    [$gameInfos];
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
