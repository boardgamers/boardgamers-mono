<script lang="ts">
  import { browser } from "$app/env";
  import type { GameContext } from "@/pages/Game.svelte";
  import { oneLineMarked } from "@/utils";
  import DOMPurify from "dompurify";
  import { getContext } from "svelte";

  const { log }: GameContext = getContext("game");

  let showLog = browser && !!localStorage.getItem("show-log");
  let logElement: HTMLDivElement;

  // Scroll to top of log
  function onLogChanged() {
    setTimeout(() => {
      if (logElement) {
        logElement.scrollTop = -logElement.scrollHeight;
      }
    });
  }

  $: onLogChanged(), [$log, showLog];

  function toggleShowLog() {
    showLog = !showLog;
    localStorage.setItem("show-log", showLog ? "true" : "");
  }

  function logToHtml(log: string) {
    return DOMPurify.sanitize(oneLineMarked(log));
  }
</script>

{#if $log.length > 0}
  <div class="mt-75 thin-scrollbar">
    <div class="d-flex align-items-baseline">
      <h3 class="mb-0">Log</h3>
      <div class="ms-2" style="font-size: smaller">
        (<a
          href={showLog ? "#hideLog" : "#showLog"}
          style="font-weight: unset !important"
          on:click|preventDefault={toggleShowLog}>{showLog ? "hide" : "show"}</a
        >)
      </div>
    </div>
    {#if showLog}
      <div class="log mt-2" bind:this={logElement}>
        {#each $log as item}
          <div>
            {@html logToHtml(item)}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .log {
    height: 300px;
    overflow-y: scroll;
    flex-direction: column-reverse;
    display: flex;

    margin-top: 4px;
    padding-left: 12px;
    border: 1px solid rgb(51, 51, 51);
    border-radius: 8px;
    padding-right: 12px;
  }
</style>
