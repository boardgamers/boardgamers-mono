<script setup lang="ts">
import { and, not } from "@vueuse/core";
import { get } from "~/api/rest";
import { useUserStore } from "~/store/user";

const route = useRoute();
const router = useRouter();
const user = useUserStore();

const isLoggedIn = computed(() => !!user.refreshToken);
const requiresAuth = computed(() => route.meta.requiresAuth !== false);

whenever(and(requiresAuth, not(isLoggedIn)), () => {
  router.push({ name: "login", query: { redirect: route.path } });
}, { immediate: true });

get("/account").then((data) => {
  if (data) {
    user.$patch({ user: data });
  }
});
</script>
<template>
  <main class="text-gray-700 dark:text-gray-200 h-full" :class="{ isLoggedIn }">
    <nav-bar class="header" />
    <navigation-drawer v-if="$route.meta.requiresAuth !== false" class="nav-drawer" />
    <router-view class="content mx-4 py-4" />
    <toaster v-show="false" />
  </main>
</template>
<style scoped lang="scss">
main {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: min-content 1fr;

  .header {
    grid-column: span 2;
  }

  .nav-drawer {
    grid-column: span 1;
    grid-row: 2 / span 1;
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
