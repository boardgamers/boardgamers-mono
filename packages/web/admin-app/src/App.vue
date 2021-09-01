<template>
  <v-app>
    <div id="app-navigation">
      <nav-bar />
      <navigation-drawer v-if="$route.meta && $route.meta.loggedIn" />
    </div>
    <v-main>
      <v-container class="main-content px-5 pt-5" fluid>
        <router-view />
      </v-container>
    </v-main>
    <toaster />
  </v-app>
</template>

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
