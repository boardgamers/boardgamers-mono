<script setup lang="ts">
import { ref, watch } from "vue-demi";
import type { Page } from "../types";

const props = withDefaults(defineProps<{value?: Page; mode?: "new" | "edit"}>(), {
  value: () => ({
    _id: {
      name: "",
      lang: "en",
    },
    title: "",
    content: "",
  }as Page),
  mode: "edit"
});

const emit = defineEmits<{(e: "update:value", value: Page): void; (e: "save", value: Page): void}>();

watch(() => props.value, () => emit("update:value", props.value), { deep: true });

const content = ref<any>(null);

function updatePage() {
  props.value.content = content.value.invoke("getMarkdown");
  emit("update:value", props.value);

  emit("save", props.value);
}

watch(() => props.value.content, () => {
  if (content.value && props.value.content) {
    content.value.invoke("setMarkdown", props.value.content, false);
  }
});
</script>
<template>
  <div>
    <form @submit.prevent="updatePage">
      <v-text-field v-model="value.title" label="Page title" required></v-text-field>
      <v-text-field v-model="value._id.name" label="Page id" required :disabled="mode !== 'new'"></v-text-field>
      <v-text-field v-model="value._id.lang" label="Page language" :disabled="mode !== 'new'" required />

      <input type="submit" class="d-none" />
    </form>

    <h3>Content</h3>
    <editor
      ref="content"
      :options="{ usageStatistics: false }"
      class="page-editor mt-2"
      :initial-value="value.content"
    />

    <v-btn type="primary" color="primary" class="mt-3 float-right" @click="updatePage"> Save </v-btn>
  </div>
</template>
<style lang="scss" scoped>
.page-editor {
  height: 500px !important;
}
</style>
