<script setup lang="ts">
import { ref, watch } from "vue-demi";
import type { Page } from "../types";
import EditorVue from "./Editor.vue";

const props = withDefaults(defineProps<{ modelValue?: Page; mode?: "new" | "edit" }>(), {
  modelValue: () =>
    ({
      _id: {
        name: "",
        lang: "en",
      },
      title: "",
      content: "",
    }) as Page,
  mode: "edit",
});

const emit = defineEmits<{
  (e: "update:modelValue", value: Page): void;
  (e: "save", value: Page): void;
  (e: "delete"): void;
}>();

watch(
  () => props.modelValue,
  () => emit("update:modelValue", props.modelValue),
);

const content = ref<typeof EditorVue | null>(null);

function updatePage() {
  props.modelValue.content = content.value?.getMarkdown();
  emit("update:modelValue", props.modelValue);

  emit("save", props.modelValue);
}

function deletePage() {
  emit("delete");
}

watch(
  () => props.modelValue.content,
  () => {
    if (props.modelValue.content) {
      content.value?.setMarkdown(props.modelValue.content);
    }
  },
);
</script>
<template>
  <div>
    <form @submit.prevent="updatePage">
      <v-text-field v-model="modelValue.title" label="Page title" required></v-text-field>
      <v-text-field v-model="modelValue._id.name" label="Page id" required :disabled="mode !== 'new'"></v-text-field>
      <v-text-field v-model="modelValue._id.lang" label="Page language" :disabled="mode !== 'new'" required />

      <input v-show="false" type="submit" />
    </form>

    <h3>Content</h3>
    <editor ref="content" class="page-editor mt-2" :initial-value="modelValue.content" />

    <div class="flex flex-row mt-3">
      <v-btn v-if="mode === 'edit'" variant="error" @click="deletePage"> Delete </v-btn>
      <v-btn class="ml-auto" @click="updatePage"> Save </v-btn>
    </div>
  </div>
</template>
<style lang="scss" scoped>
.page-editor {
  height: 500px !important;
}
</style>
<style scoped>
h3 {
  @apply font-bold my-4;
}
</style>
