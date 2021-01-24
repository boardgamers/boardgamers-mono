<template>
  <div v-if="$route.name === 'game'" :class="['sidebar-container', { open }]">
    <transition name="slide">
      <div class="px-3 pb-3 sidebar thin-scrollbar text-light" v-if="open">
        <portal-target name="sidebar" />
      </div>
    </transition>
    <b-avatar
      icon="gear"
      button
      :size="45"
      @click="open = !open"
      :class="['sidebar-fab', { chatOpen: $store.state.chatOpen }]"
    ></b-avatar>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";

@Component({
  created() {
    this.open = localStorage.getItem("showSidebar") === "1";
  },
})
export default class Sidebar extends Vue {
  open = false;

  @Watch("open")
  updateSidebarStorage() {
    localStorage.setItem("showSidebar", this.open ? "1" : "0");
  }
}
</script>
<style lang="scss">
@import "../stylesheets/variables.scss";

// Position:sticky does not work well on safari, 04/07/2020
// So we use two elements: .sidebar-container for adjusting the layout (would be great if sticky)
// , and .sidebar is fixed (instead of just being normal position) for content
// Both have the same animation

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
  border-left: 1px solid rgba($color: #cccccc, $alpha: 0.2);
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
  bottom: $fab-bottom;
  right: $fab-right;
}

// Only way found to not have sidebar button overlap open chat window
// when the chat window is fullscreen
@media screen and (max-width: 450px) {
  .sidebar-fab.chatOpen {
    opacity: 0;
  }
}

.thin-scrollbar {
  scrollbar-width: thin;

  ::-webkit-scrollbar-track,
  &::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.3);
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
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    background-color: #3c8dbc;
    overflow-x: auto;
  }
}
</style>
