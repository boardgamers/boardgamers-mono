<script setup lang="ts">
import ToastUIEditor from "@toast-ui/editor";

const editor = ref<HTMLDivElement | null>(null);
let uiEditor: ToastUIEditor | null = null;

defineExpose({
  setMarkdown(str: string) {
    uiEditor?.setMarkdown(str, false);
  },
  getMarkdown(): string | undefined {
    return uiEditor?.getMarkdown();
  }
});

const props = defineProps<{initialValue?: string}>();

onMounted(() => {
  uiEditor = new ToastUIEditor({ el: editor.value!, usageStatistics: false, previewStyle: "vertical", initialValue: props.initialValue });
});

onUnmounted(() => {
  uiEditor?.destroy();
  uiEditor = null;
});
</script>
<template>
  <div ref="editor"></div>
</template>
