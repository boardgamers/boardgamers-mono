<script setup lang="ts">
const hasFocus = ref(false);
const clicking = ref(false);
const props = withDefaults(
  defineProps<{ label: string; modelValue: any; searchInput: string; items: Array<{ value: any; text: string }> }>(),
  {
    items: () => [],
  },
);
const emit = defineEmits<{
  (e: "update:searchInput", value: string): void;
  (e: "update:modelValue", value: any): void;
}>();
</script>
<template>
  <div>
    <v-text-field
      :label="props.label"
      :model-value="props.searchInput"
      autocomplete="off"
      @update:modelValue="emit('update:searchInput', $event)"
      @focus="hasFocus = true"
      @blur="hasFocus = false"
    />
    <div v-if="items.length > 0 && (hasFocus || clicking)" class="relative">
      <div
        class="absolute top-0 right-0 left-0 bg-white border border-indigo-600 rounded dark:border-gray-500 dark:bg-black"
      >
        <v-list-item
          v-for="item in items"
          :key="item.value"
          @mousedown="clicking = true"
          @click.stop="(clicking = false), emit('update:modelValue', item.value)"
        >
          {{ item.text }}
        </v-list-item>
      </div>
    </div>
  </div>
</template>
