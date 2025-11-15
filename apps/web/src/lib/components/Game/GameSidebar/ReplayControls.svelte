<script lang="ts">
  import type { GameContext } from "$lib/types/GameContext";
  import IconSkipBackwardFill from "@iconify-svelte/bi/skip-backward-fill";
  import IconSkipEndFill from "@iconify-svelte/bi/skip-end-fill";
  import IconSkipForwardFill from "@iconify-svelte/bi/skip-forward-fill";
  import IconSkipStartFill from "@iconify-svelte/bi/skip-start-fill";
  import IconStopFill from "@iconify-svelte/bi/stop-fill";
  import { Button } from "@sveltestrap/sveltestrap";

  import { useSidebarOpen } from "$lib/composition/useSidebarOpen";
  import { getContext } from "svelte";

  const { sidebarOpen } = useSidebarOpen();
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
      <Button color="accent" size="sm" onclick={startReplay}>Replay</Button>
    {:else}
      <div class="d-flex align-items-center">
        <Button size="sm" class="me-1" onclick={() => replayTo($replayData.start)}>
          <IconSkipBackwardFill style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="mx-1" onclick={() => replayTo(Math.max($replayData.start, $replayData.current - 1))}>
          <IconSkipStartFill style="margin-bottom: 0.25em" />
        </Button>
        <span
          class="mx-1 text-center"
          style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-grow: 1"
        >
          {$replayData.current} / {$replayData.end}
        </span>
        <Button size="sm" class="mx-1" onclick={() => replayTo(Math.min($replayData.end, $replayData.current + 1))}>
          <IconSkipEndFill style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="mx-1" onclick={() => replayTo($replayData.end)}>
          <IconSkipForwardFill style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="ms-1" onclick={endReplay}>
          <IconStopFill style="margin-bottom: 0.25em; color: orange" />
        </Button>
      </div>
    {/if}
  </div>
{/if}
{#if $replayData && !$sidebarOpen}
  <div use:portal={"floating-controls"}>
    <div
      style="position: fixed; bottom: 0; left: 0; right: calc(var(--fab-right) + 8em); pointer-events: none"
      class="d-flex pb-3 text-light"
    >
      <Button size="sm" class="me-1 ms-auto" onclick={() => replayTo($replayData.start)} style="pointer-events: all">
        <IconSkipBackwardFill style="margin-bottom: 0.25em" />
      </Button>
      <Button
        size="sm"
        class="mx-1"
        onclick={() => replayTo(Math.max($replayData.start, $replayData.current - 1))}
        style="pointer-events: all"
      >
        <IconSkipStartFill style="margin-bottom: 0.25em" />
      </Button>
      <span
        class="mx-1 px-1 text-center"
        style="
        text-overflow: ellipsis; 
        display: inline-flex; 
        align-items: center; 
        overflow: hidden; 
        white-space: nowrap; 
        background-color: var(--bs-secondary); 
        border-radius: 0.2em;
        pointer-events: all
      "
      >
        {$replayData.current} / {$replayData.end}
      </span>
      <Button
        size="sm"
        class="mx-1"
        onclick={() => replayTo(Math.min($replayData.end, $replayData.current + 1))}
        style="pointer-events: all"
      >
        <IconSkipEndFill style="margin-bottom: 0.25em" />
      </Button>
      <Button size="sm" class="mx-1" onclick={() => replayTo($replayData.end)} style="pointer-events: all">
        <IconSkipForwardFill style="margin-bottom: 0.25em" />
      </Button>
      <Button size="sm" class="ms-1 me-auto" onclick={endReplay} style="pointer-events: all">
        <IconStopFill style="margin-bottom: 0.25em; color: orange" />
      </Button>
    </div>
  </div>
{/if}
