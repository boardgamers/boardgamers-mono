<script lang="ts">
  import { Button, Icon } from "@/modules/cdk";
  import type { GameContext } from "@/pages/Game.svelte";
  import skipBackwardFill from "@iconify/icons-bi/skip-backward-fill";
  import skipForwardFill from "@iconify/icons-bi/skip-forward-fill";
  import skipStartFill from "@iconify/icons-bi/skip-start-fill";
  import skipEndFill from "@iconify/icons-bi/skip-end-fill";
  import stopFill from "@iconify/icons-bi/stop-fill";

  import { getContext } from "svelte";

  const { gameInfo, replayData, emitter } = getContext("game") as GameContext;

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
          <Icon icon={skipBackwardFill} style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="mx-1" on:click={() => replayTo(Math.max($replayData.start, $replayData.current - 1))}>
          <Icon icon={skipStartFill} style="margin-bottom: 0.25em" />
        </Button>
        <span
          class="mx-1 text-center"
          style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-grow: 1"
        >
          {$replayData.current} / {$replayData.end}
        </span>
        <Button size="sm" class="mx-1" on:click={() => replayTo(Math.min($replayData.end, $replayData.current + 1))}>
          <Icon icon={skipEndFill} style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="mx-1" on:click={() => replayTo($replayData.end)}
          ><Icon icon={skipForwardFill} style="margin-bottom: 0.25em" /></Button
        >
        <Button size="sm" class="ms-1" on:click={endReplay}
          ><Icon icon={stopFill} style="margin-bottom: 0.25em; color: orange" /></Button
        >
      </div>
    {/if}
  </div>
{/if}
