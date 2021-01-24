<template>
  <div id="app">
    <div id="app-layout" style="overflow-x: hidden">
      <div style="flex-grow: 1; display: flex; flex-direction: column">
        <Navbar />
        <main class="container-fluid p-relative">
          <router-view />
        </main>
        <div style="flex-grow: 1" />
        <Footer />
      </div>
      <Sidebar />
    </div>
    <Alert />
    <audio preload="none" id="sound-notification">
      <source src="/audio/notification.mp3" type="audio/mpeg" />
      <source src="/audio/notification.ogg" type="audio/ogg" />
    </audio>
    <b-modal
      v-if="$store.state.updateAvailable"
      v-model="modalShow"
      size="md"
      @ok="refresh"
      title="Update available"
      ok-title="Refresh"
    >
      An update to the application is available. Refresh to get the changes.
    </b-modal>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import Alert from "@/components/Alert.vue";
import Navbar from "@/components/Navbar.vue";
import Footer from "@/components/Footer.vue";
import Sidebar from "@/components/Sidebar.vue";

@Component({
  components: {
    Alert,
    Footer,
    Navbar,
    Sidebar,
  },
})
export default class App extends Vue {
  modalShow = true;

  refresh() {
    // Force reload is NECESSARY
    location.reload(true);
  }
}
</script>

<style lang="scss">
@import "stylesheets/main.scss";

#app {
  height: 100%;
  display: flex;
  flex-direction: column;
}

#app-layout {
  height: 100%;
  display: flex;
  flex-direction: row;
}
</style>
