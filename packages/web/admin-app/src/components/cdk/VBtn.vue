<script setup lang="ts">
import { PropType } from "vue";

const props = defineProps({
  type: { type: String as PropType<"button" | "submit">, default: "button" }
});
</script>

<template>
  <button
    class="px-4 py-1 rounded inline-block bg-blue-600 text-white cursor-pointer hover:bg-blue-700 disabled:cursor-default disabled:bg-gray-600 disabled:opacity-50"
    :type="props.type"
  >
    <slot />
  </button>
</template>
