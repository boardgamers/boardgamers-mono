<script setup lang="ts">
import { useRouter } from "vue-router";
import { ref } from "vue-demi";
import type { Page } from "../../types";
import { handleError, handleSuccess } from "../../utils";
import { get, post } from "~/api/rest";
import { usePageStore } from "~/store/pages";

const pages = usePageStore();
const router = useRouter();
const page = ref<Page | void>();

async function save() {
  try {
    const path = `/page/${page.value!._id.name}/${page.value!._id.lang}`;

    await post(`/admin${path}`, page.value);
    handleSuccess("Page created");

    pages.$patch({ pages: await get("/admin/page") });
    router.push(path);
  }
  catch (err) {
    handleError(err);
  }
}
</script>
<template>
  <div>
    <h2>New page</h2>
    <page-edit v-model="page" mode="new" @save="save" />
  </div>
</template>
