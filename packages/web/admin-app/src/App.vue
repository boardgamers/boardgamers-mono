<script setup lang="ts">
import { and, not } from '@vueuse/core';
import { useHead } from '@vueuse/head';
import { get } from './api/rest';
import { useUserStore } from './store/user';

useHead({
  title: 'BGS Admin',
  meta: [
    { name: 'description', content: 'Admin for boardgamers.space' },
  ],
});

const loaded = ref(false);

const router = useRouter();
const route = useRoute();
const user = useUserStore();

const isLoggedIn = computed(() => !!user.refreshToken);
const requiresAuth = computed(() => route.meta.requiresAuth !== false);

function checkRoute() {
  if (and(requiresAuth, not(isLoggedIn)).value) {
    router.push({ name: "login", query: { redirect: route.path } });
  }
}

get("/account").then((data) => {
  if (data) {
    user.$patch({ user: data });
  }
  checkRoute();
}).finally(() => loaded.value = true);

watch([requiresAuth, isLoggedIn], checkRoute);
</script>

<template>
  <router-view v-if="loaded" />
</template>
