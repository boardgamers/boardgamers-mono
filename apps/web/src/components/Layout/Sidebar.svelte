<script lang="ts">
  import { sidebarOpen } from "@/lib/stores.svelte";
  import { Button } from "@/modules/cdk";
  import IconGear from "@/components/icons/IconGear.svelte";
</script>

<div class="sidebar-container" class:open={$sidebarOpen}>
  <aside class="px-3 pb-3 sidebar thin-scrollbar text-white">
    <div id="sidebar"></div>
  </aside>
  <Button
    color="secondary"
    onclick={() => ($sidebarOpen = !$sidebarOpen)}
    class={"rounded-full sidebar-fab" + (false ? " chatOpen" : "")}
  >
    <IconGear class="absolute-center" style="width: 1.5rem; height: 1.5rem" />
  </Button>
</div>

<style global>
  /* Position:sticky does not work well on safari, 04/07/2020
     So we use two elements: .sidebar-container for adjusting the layout (would be great if sticky),
     and .sidebar is fixed (instead of just being normal position) for content.
     Both have the same animation. */

  .sidebar,
  .sidebar-container.open {
    min-width: var(--sidebar-width);
    width: var(--sidebar-width);
  }

  .sidebar {
    position: fixed;
    height: 100vh;
    overflow-x: hidden;
    overflow-y: auto;
    background-color: #444;
    border-left: 1px solid rgba(204, 204, 204, 0.2);
  }

  .sidebar-container {
    transition: all 0.3s ease;
    min-width: 0;
    width: 0;
  }

  @media screen and (max-width: 600px) {
    .sidebar-container.open {
      width: 0;
      min-width: 0;
    }

    .sidebar-container.open .sidebar {
      opacity: 1;
      pointer-events: auto;
    }

    .sidebar {
      position: fixed;
      width: calc(100vw - 1rem); /* no idea why the -1 rem is needed */
      top: 0;
      right: 0;
      opacity: 0;
      pointer-events: none;
      transition: all 0.3s ease;
    }
  }

  .sidebar-fab {
    position: fixed !important;
    bottom: var(--fab-bottom);
    right: var(--fab-right);
    width: var(--fab-width);
    height: var(--fab-width);
  }

  .sidebar-fab .bi {
    font-size: 24px;
    margin-left: -2px;
  }

  .thin-scrollbar {
    scrollbar-width: thin;
  }

  .thin-scrollbar::-webkit-scrollbar-track {
    box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.3);
    border-radius: 20px;
    background-color: #f5f5f522;
    overflow-x: auto;
  }

  .thin-scrollbar::-webkit-scrollbar {
    width: 5px;
    height: 5px;
    background-color: #f5f5f522;
    overflow-x: auto;
  }

  .thin-scrollbar::-webkit-scrollbar-thumb {
    border-radius: 10px;
    box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    background-color: #3c8dbc;
    overflow-x: auto;
  }
</style>
