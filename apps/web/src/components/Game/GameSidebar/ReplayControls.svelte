<script lang="ts">
  import { Button } from "@/modules/cdk";
  import IconSkipBackwardFill from "@/components/icons/IconSkipBackwardFill.svelte";
  import IconSkipForwardFill from "@/components/icons/IconSkipForwardFill.svelte";
  import IconSkipStartFill from "@/components/icons/IconSkipStartFill.svelte";
  import IconSkipEndFill from "@/components/icons/IconSkipEndFill.svelte";
  import IconStopFill from "@/components/icons/IconStopFill.svelte";
  import type { GameContext } from "@/routes/game/[gameId]/game-context";

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
  <div class="mt-3">
    {#if !context.replayData}
      <Button color="accent" size="sm" onclick={startReplay}>Replay</Button>
    {:else}
      <div class="flex items-center">
        <Button size="sm" class="me-1" onclick={() => replayTo(context.replayData!.start)}>
          <IconSkipBackwardFill style="margin-bottom: 0.25em" />
        </Button>
        <Button
          size="sm"
          class="mx-1"
          onclick={() => replayTo(Math.max(context.replayData!.start, context.replayData!.current - 1))}
        >
          <IconSkipStartFill style="margin-bottom: 0.25em" />
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
          <IconSkipEndFill style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="mx-1" onclick={() => replayTo(context.replayData!.end)}>
          <IconSkipForwardFill style="margin-bottom: 0.25em" />
        </Button>
        <Button size="sm" class="ms-1" onclick={endReplay}>
          <IconStopFill style="margin-bottom: 0.25em; color: orange" />
        </Button>
      </div>
    {/if}
  </div>
{/if}
{#if context.replayData && !$sidebarOpen}
  <Portal target="#floating-controls">
    <div
      style="position: fixed; bottom: 0; left: 0; right: calc(var(--fab-right) + 8em); pointer-events: none"
      class="flex pb-3 text-white"
    >
      <Button
        size="sm"
        class="me-1 ms-auto"
        onclick={() => replayTo(context.replayData!.start)}
        style="pointer-events: all"
      >
        <IconSkipBackwardFill style="margin-bottom: 0.25em" />
      </Button>
      <Button
        size="sm"
        class="mx-1"
        onclick={() => replayTo(Math.max(context.replayData!.start, context.replayData!.current - 1))}
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
        background-color: rgb(229, 231, 235);
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
        <IconSkipEndFill style="margin-bottom: 0.25em" />
      </Button>
      <Button size="sm" class="mx-1" onclick={() => replayTo(context.replayData!.end)} style="pointer-events: all">
        <IconSkipForwardFill style="margin-bottom: 0.25em" />
      </Button>
      <Button size="sm" class="ms-1 me-auto" onclick={endReplay} style="pointer-events: all">
        <IconStopFill style="margin-bottom: 0.25em; color: orange" />
      </Button>
    </div>
  </Portal>
{/if}
