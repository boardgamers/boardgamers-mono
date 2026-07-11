<script lang="ts">
  import { Button, Icon } from "@/modules/cdk";
  import type { GameContext } from "@/routes/game/[gameId]/game-context";
  import skipBackwardFill from "@iconify/icons-bi/skip-backward-fill.js";
  import skipForwardFill from "@iconify/icons-bi/skip-forward-fill.js";
  import skipStartFill from "@iconify/icons-bi/skip-start-fill.js";
  import skipEndFill from "@iconify/icons-bi/skip-end-fill.js";
  import stopFill from "@iconify/icons-bi/stop-fill.js";

  import { getContext } from "svelte";
  import { sidebarOpen } from "@/lib/stores.svelte";
  import Portal from "@/modules/portal/Portal.svelte";

  const context = getContext("game") as GameContext;
  const { emitter } = context;

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

{#if context.gameInfo?.viewer?.replayable}
  <div class="mt-75">
    {#if !context.replayData}
      <Button color="accent" size="sm" onclick={startReplay}>Replay</Button>
    {:else}
      <div class="d-flex align-items-center">
        <Button size="sm" class="me-1" onclick={() => replayTo(context.replayData!.start)}>
          <Icon icon={skipBackwardFill} style="margin-bottom: 0.25em" />
        </Button>
        <Button
          size="sm"
          class="mx-1"
          onclick={() => replayTo(Math.max(context.replayData!.start, context.replayData!.current - 1))}
        >
          <Icon icon={skipStartFill} style="margin-bottom: 0.25em" />
        </Button>
        <span
          class="mx-1 text-center"
          style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-grow: 1"
        >
          {context.replayData!.current} / {context.replayData!.end}
        </span>
        <Button
          size="sm"
          class="mx-1"
          onclick={() => replayTo(Math.min(context.replayData!.end, context.replayData!.current + 1))}
        >
          <Icon icon={skipEndFill} style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="mx-1" onclick={() => replayTo(context.replayData!.end)}>
          <Icon icon={skipForwardFill} style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="ms-1" onclick={endReplay}>
          <Icon icon={stopFill} style="margin-bottom: 0.25em; color: orange" />
        </Button>
      </div>
    {/if}
  </div>
{/if}
{#if context.replayData && !$sidebarOpen}
  <Portal target="#floating-controls">
    <div
      style="position: fixed; bottom: 0; left: 0; right: calc(var(--fab-right) + 8em); pointer-events: none"
      class="d-flex pb-3 text-light"
    >
      <Button
        size="sm"
        class="me-1 ms-auto"
        onclick={() => replayTo(context.replayData!.start)}
        style="pointer-events: all"
      >
        <Icon icon={skipBackwardFill} style="margin-bottom: 0.25em" />
      </Button>
      <Button
        size="sm"
        class="mx-1"
        onclick={() => replayTo(Math.max(context.replayData!.start, context.replayData!.current - 1))}
        style="pointer-events: all"
      >
        <Icon icon={skipStartFill} style="margin-bottom: 0.25em" />
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
        {context.replayData!.current} / {context.replayData!.end}
      </span>
      <Button
        size="sm"
        class="mx-1"
        onclick={() => replayTo(Math.min(context.replayData!.end, context.replayData!.current + 1))}
        style="pointer-events: all"
      >
        <Icon icon={skipEndFill} style="margin-bottom: 0.25em" />
      </Button>
      <Button size="sm" class="mx-1" onclick={() => replayTo(context.replayData!.end)} style="pointer-events: all">
        <Icon icon={skipForwardFill} style="margin-bottom: 0.25em" />
      </Button>
      <Button size="sm" class="ms-1 me-auto" onclick={endReplay} style="pointer-events: all">
        <Icon icon={stopFill} style="margin-bottom: 0.25em; color: orange" />
      </Button>
    </div>
  </Portal>
{/if}
