<script lang="ts">
  import { useSidebarOpen } from "@/composition/useSidebarOpen";
  import { Button, Icon } from "@/modules/cdk";
  import gear from "@iconify/icons-bi/gear.js";

  const { sidebarOpen } = useSidebarOpen();
</script>

<div class="sidebar-container" class:open={$sidebarOpen}>
  <aside class="px-3 pb-3 sidebar thin-scrollbar text-light">
    <div id="sidebar" />
  </aside>
  <Button
    color="secondary"
    on:click={() => ($sidebarOpen = !$sidebarOpen)}
    class={"rounded-circle b-avatar sidebar-fab" + (false ? " chatOpen" : "")}
  >
    <Icon icon={gear} class="absolute-center" style="width: 1.5rem; height: 1.5rem" />
  </Button>
</div>

<style lang="postcss" global>
  /* Position:sticky does not work well on safari, 04/07/2020
// So we use two elements: .sidebar-container for adjusting the layout (would be great if sticky)
// , and .sidebar is fixed (instead of just being normal position) for content
// Both have the same animation */

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

      .sidebar {
        opacity: 1;
        pointer-events: auto;
      }
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

    .bi {
      font-size: 24px;
      margin-left: -2px;
    }
  }

  .thin-scrollbar {
    scrollbar-width: thin;

    ::-webkit-scrollbar-track,
    &::-webkit-scrollbar-track {
      box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.3);
      border-radius: 20px;
      background-color: #f5f5f522;
      overflow-x: auto;
    }

    ::-webkit-scrollbar,
    &::-webkit-scrollbar {
      width: 5px;
      height: 5px;
      background-color: #f5f5f522;
      overflow-x: auto;
    }

    ::-webkit-scrollbar-thumb,
    &::-webkit-scrollbar-thumb {
      border-radius: 10px;
      box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
      background-color: #3c8dbc;
      overflow-x: auto;
    }
  }
</style>
