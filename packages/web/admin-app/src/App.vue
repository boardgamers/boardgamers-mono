<template>
  <v-app>
    <div id="app-navigation">
      <NavBar />
      <NavigationDrawer v-if="$route.meta && $route.meta.loggedIn" />
    </div>
    <v-main>
      <v-container class="main-content px-5 pt-5" fluid>
        <router-view />
      </v-container>
    </v-main>
    <Toaster />
  </v-app>
</template>

<script lang="ts">
import NavBar from "./components/NavBar.vue";
import NavigationDrawer from "./components/NavigationDrawer.vue";
import Toaster from "./components/Toaster.vue";

export default {
  name: "app",
  components: {
    NavBar,
    NavigationDrawer,
    Toaster,
  },
};
</script>

<style lang="scss">
@import "./style/main.scss";

#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}

body {
  margin: 0;
}

html,
body,
#app {
  height: 100%;
}
</style>
