<script lang="ts">
  import type { PlayerInfo } from "@shared/types/game";
  import { classnames } from "@/utils"
  import { user } from "@/store";

  export let player: PlayerInfo
  export let showVp = true
  export let status = ''
  let className = ''
  export { className as class }

  export let userId: string | undefined;
  $: highlightedPlayerId = userId ?? $user?._id
</script>

<div
  style={`background-image: url('${
    player.faction ? `/images/factions/icons/${player.faction}.svg` : `/api/user/${player._id}/avatar`
  }')`}
  title={player.name}
  class={classnames("player-avatar", className)}
  class:current={highlightedPlayerId && player._id === highlightedPlayerId}
>
  {#if showVp}
    <span class={`vp ${status}`}>{player.score}</span>
  {/if}
</div>

<style lang="postcss">
  .player-avatar {
    height: 2em;
    width: 2em;
    min-width: 2em;
    min-height: 2em;
    display: inline-block;
    position: relative;
    border-radius: 50%;
    vertical-align: middle;
    background-size: cover;

    .vp {
      position: absolute;
      right: -5px;
      bottom: -5px;
      font-size: 0.7em;
      border-radius: 5px;
      color: white;
      background-color: #838383;
      width: 20px;
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
