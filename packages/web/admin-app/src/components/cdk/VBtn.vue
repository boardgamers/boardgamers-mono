<script setup lang="ts">

const props = withDefaults(defineProps<{type: "button" | "submit"; icon?: boolean}>(), { type: "button" });
</script>

<template>
  <button
    class="px-4 py-1 flex gap-2 items-center rounded inline-block bg-blue-600 text-white cursor-pointer hover:bg-blue-700 disabled:cursor-default disabled:bg-gray-600 disabled:opacity-50"
    :class="{ 'px-1': props.icon }"
    :type="props.type"
  >
    <slot />
  </button>
</template>
