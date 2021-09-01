<script lang="ts">
import { Button, Icon } from "@/modules/cdk";
import type { GameContext } from "@/pages/Game.svelte";

import { getContext } from "svelte";

const { gameInfo, replayData, emitter } = getContext("game") as GameContext
 
function startReplay() {
  emitter.emit("replay:start");
}

function replayTo(dest: number) {
  emitter.emit("replay:to", dest);
}

function endReplay() {
  emitter.emit("replay:end");
}
</script>

{#if $gameInfo?.viewer?.replayable}
  <div class="mt-75">
    {#if !$replayData}
      <Button color="info" size="sm" on:click={startReplay}>Replay</Button>
    {:else}
      <div class="d-flex align-items-center">
        <Button size="sm" class="me-1" on:click={() => replayTo($replayData.start)}>
          <Icon name="skip-backward-fill" />
        </Button>
        <Button size="sm" class="mx-1" on:click={() => replayTo(Math.max($replayData.start, $replayData.current - 1))}>
          <Icon name="skip-start-fill" />
        </Button>
        <span
          class="mx-1 text-center"
          style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-grow: 1"
        >
          {$replayData.current} / {$replayData.end}
        </span>
        <Button size="sm" class="mx-1" on:click={() => replayTo(Math.min($replayData.end, $replayData.current + 1))}>
          <Icon name="skip-end-fill" />
        </Button>
        <Button size="sm" class="mx-1" on:click={() => replayTo($replayData.end)}
          ><Icon name="skip-forward-fill" /></Button
        >
        <Button size="sm" class="ms-1" on:click={endReplay}><Icon name="stop-fill" color="danger" /></Button>
      </div>
    {/if}
  </div>
{/if}
