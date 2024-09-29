<script setup lang="ts">
const props = withDefaults(defineProps<{ type: "button" | "submit"; variant: "primary" | "error"; icon?: boolean }>(), {
  type: "button",
  variant: "primary",
});
</script>

<template>
  <button
    class="px-4 py-1 flex gap-2 items-center rounded inline-block text-white cursor-pointer disabled:cursor-default disabled:bg-gray-600 disabled:opacity-50"
    :class="[{ 'px-1': props.icon }, variant]"
    :type="props.type"
  >
    <slot />
  </button>
</template>
<style lang="css" scoped>
.primary {
  @apply bg-blue-600 hover:bg-blue-700;
}
.error {
  @apply bg-red-600 hover:bg-red-700;
}
</style>
