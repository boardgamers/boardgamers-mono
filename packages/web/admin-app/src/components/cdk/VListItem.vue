<script setup lang="ts">
import { useAttrs } from "vue";

const props = defineProps<{to?: string; selected?: boolean; target?: string}>();
const attrs = useAttrs<{onClick?: Function}>();

const dynamic = computed(() => props.to !== undefined || attrs.onClick);
</script>

<template>
  <component
    :is="to === undefined ? 'li' : (props.target ? 'a' : 'router-link')"
    :[props.target?`href`:`to`]="to"
    :target="target"
    class="h-10 flex items-center p-2"
    :class="{
      'dark:hover:bg-dark-400': dynamic,
      'hover:bg-blue-100': dynamic,
      'cursor-pointer': dynamic,
      'bg-blue-400': props.selected,
      'hover:bg-blue-400': props.selected,
      'dark:bg-dark-200': props.selected,
      'dark:hover:bg-dark-300': props.selected,
      'select-none': dynamic,
    }"
  >
    <slot />
  </component>
</template>
