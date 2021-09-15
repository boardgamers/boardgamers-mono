<script setup lang="ts">
import { ref, watch } from "vue-demi";
import { handleError, handleSuccess } from "~/utils";
import { Page } from "~/types";
import { get, post } from "~/api/rest";

const page = ref<Page |null>(null);
const loading = ref(true);

const props = defineProps<{name: string; lang: string}>();

async function save() {
  try {
    await post(`/admin/page/${page.value!._id.name}/${page.value!._id.lang}`, page.value);
    handleSuccess("Page updated");
  }
  catch (err) {
    handleError(err);
  }
}

watch(() => [props.name, props.lang], async () => {
  try {
    page.value = await get(`/page/${props.name}/${props.lang}`);
  }
  catch (err) {
    handleError(err);
  }
  finally {
    loading.value = false;
  }
}, { immediate: true });
</script>
<template>
  <div>
    <h2 v-if="page">{{ page._id.name }} - {{ page._id.lang }}</h2>
    <page-edit v-if="page" v-model="page" mode="edit" @save="save" />
  </div>
</template>
