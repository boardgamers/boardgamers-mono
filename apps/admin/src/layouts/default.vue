<script setup lang="ts">
import { useUserStore } from "~/store/user";

const user = useUserStore();

const isLoggedIn = computed(() => !!user.refreshToken);
</script>
<template>
  <main class="text-gray-700 dark:text-gray-200 h-full" :class="{ isLoggedIn }">
    <nav-bar class="header" />
    <navigation-drawer
      v-if="isLoggedIn"
      class="nav-drawer dark:bg-dark-700 bg-blue-300 border-r-indigo-600 border-r dark:border-r-dark-50 overflow-y-auto"
    />
    <router-view class="content mx-4 py-4" />
  </main>
</template>
<style scoped lang="scss">
main {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: min-content 1fr;

  .header {
    grid-column: 2 / span 1;
  }

  .nav-drawer {
    grid-column: span 1;
    grid-row: 1 / span 2;
  }

  .content {
    grid-column: 1 / span 1;
    grid-row: 2 / span 1;
  }

  &.isLoggedIn {
    grid-template-columns: 15rem 1fr;

    .content {
      grid-column: 2 / span 1;
      grid-row: 2 / span 1;
    }
  }
}
</style>
