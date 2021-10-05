<script setup lang="ts">
import { ref, watch } from "vue-demi";
import { handleError, handleSuccess } from "~/utils";
import { Page } from "~/types";
import { get, post, deleteApi } from "~/api/rest";
import { usePageStore } from "~/store/pages";

const pages = usePageStore();
const page = ref<Page |null>(null);
const loading = ref(true);
const router = useRouter();

const props = defineProps<{name: string; lang: string}>();

async function save() {
  try {
    await post(`/admin/page/${page.value!._id.name}/${page.value!._id.lang}`, page.value);
    handleSuccess("Page deleted");
  }
  catch (err) {
    handleError(err);
  }
}

async function onDelete() {
  try {
    await deleteApi(`/admin/page/${page.value!._id.name}/${page.value!._id.lang}`);
    handleSuccess("Page updated");

    pages.$patch({ pages: await get("/admin/page") });
    router.push('/');
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
    <h2 v-if="page" class="text-lg uppercase font-bold my-4">{{ page._id.name }} - {{ page._id.lang }}</h2>
    <page-edit v-if="page" v-model="page" mode="edit" @save="save" @delete="onDelete" />
  </div>
</template>
