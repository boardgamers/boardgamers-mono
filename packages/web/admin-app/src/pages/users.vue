<script setup lang="ts">
import type { IUser } from "@shared/types/user";
import { ref, watch } from "vue-demi";
import { useRouter } from "vue-router";
import { handleError } from "../utils";
import { get } from "~/api/rest";

const username = ref("");
const email = ref("");
const loading = ref(false);
const emailLoading = ref(false);
const items = ref<Array<{ text: string; value: string }>>([]);
const emailItems = ref<Array<{ text: string; value: string }>>([]);
const search = ref("");
const emailSearch = ref("");

watch(search, async (search: string) => {
  if (search !== "") {
    try {
      loading.value = true;

      const users: Array<IUser> = await get('/admin/users/search', { query: search });

      items.value = users.map(user => ({ text: user.account.username, value: user.account.username }));
    }
    catch (err) {
      handleError(err);
    }
    finally {
      loading.value = false;
    }
  }
  else {
    items.value = [];
  }
});

watch(emailSearch, async (query: string) => {
  if (query !== "") {
    try {
      emailLoading.value = true;

      const users: Array<IUser> = await get(`/admin/users/search`, { query, mode: "email" });

      emailItems.value = users.map(user => ({ text: user.account.username, value: user.account.username }));
    }
    catch (err) {
      handleError(err);
    }
    finally {
      emailLoading.value = false;
    }
  }
  else {
    emailItems.value = [];
  }
});

const router = useRouter();

watch(username, (username) => {
  if (username) {
    router.push(`/user/${encodeURIComponent(username)}`);
  }
});
</script>
<template>
  <div>
    <v-autocomplete v-model="username" v-model:search-input="search" label="Username" :loading="loading" :items="items">
    </v-autocomplete>

    <v-autocomplete
      v-model="email"
      v-model:search-input="emailSearch"
      label="Email"
      :loading="emailLoading"
      :items="emailItems"
    >
    </v-autocomplete>
  </div>
</template>
