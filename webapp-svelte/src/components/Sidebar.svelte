<script lang="ts">
  import { Button, Icon } from "@/modules/cdk";
import { route } from "@/modules/router";
  
  let open = localStorage.getItem("showSidebar") === "1";
  
  function toggleOpen() {
    open = !open;
    localStorage.setItem("showSidebar", open ? "1" : "0");
  }
</script>

{#if $route?.meta.sidebar}
  <div class="sidebar-container" class:open>
    <transition name="slide">
      <div class="px-3 pb-3 sidebar thin-scrollbar text-light" v-if="open">
        <portal-target name="sidebar" />
      </div>
    </transition>
    <Button
      color="secondary"
      on:click={toggleOpen}
      class={"rounded-circle b-avater sidebar-fab" + (false ? " chatOpen" : "")}
    >
      <Icon name="gear" />
    </Button>
  </div>
{/if}

<style lang="postcss" global>
  /* Position:sticky does not work well on safari, 04/07/2020
// So we use two elements: .sidebar-container for adjusting the layout (would be great if sticky)
// , and .sidebar is fixed (instead of just being normal position) for content
// Both have the same animation */

  .slide-enter-active,
  .slide-leave-active {
    transition: all 0.3s ease;
  }
  .slide-enter,
  .slide-leave-to {
    transform: translateX(320px);
  }
  .sidebar,
  .sidebar-container.open {
    width: 320px;
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

    width: 0;
  }

  @media screen and (max-width: 600px) {
    .sidebar-container,
    .sidebar-container.open {
      width: 0;
    }

    .sidebar {
      position: fixed;
      width: 100vw;
      top: 0;
      right: 0;
    }

    .slide-enter,
    .slide-leave-to {
      transform: translateX(100vw);
    }
  }

  .sidebar-fab {
    position: fixed !important;
    bottom: var(--fab-bottom);
    right: var(--fab-right);
    width: 45px;
    height: 45px;

    .bi {
      font-size: 24px;
      margin-left: -2px;
    }
  }

  /* Only way found to not have sidebar button overlap open chat window
// when the chat window is fullscreen */
  @media screen and (max-width: 450px) {
    .sidebar-fab.chatOpen {
      opacity: 0;
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
