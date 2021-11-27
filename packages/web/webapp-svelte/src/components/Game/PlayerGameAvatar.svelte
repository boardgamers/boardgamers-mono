<script lang="ts">
  import { browser } from "$app/env";
  import type { PlayerInfo } from "@bgs/types";
  import { classnames } from "@/utils";
  import { user } from "@/store";

  export let player: PlayerInfo;
  export let showVp = true;
  export let status = "";
  let className = "";
  export { className as class };

  export let userId: string | undefined;

  function isColor(strColor: string) {
    // todo : better solution for SSR
    return browser ? CSS.supports("color", strColor) : false;
  }

  $: highlightedPlayerId = userId ?? $user?._id;
  $: justColor = player.faction && isColor(player.faction);
  $: style = justColor
    ? `background-color: ${player.faction}`
    : `background-image: url('${
        player.faction ? `/images/factions/icons/${player.faction}.svg` : `/api/user/${player._id}/avatar`
      }')`;
</script>

<div
  {style}
  title={player.name}
  class={classnames("player-avatar", className)}
  class:current={highlightedPlayerId && player._id === highlightedPlayerId}
>
  {justColor ? player.name.slice(0, 2) : ""}
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
      border: 3px solid #333;

      .vp {
        background-color: #6673bc;
      }
    }
  }
</style>
