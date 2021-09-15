<script setup lang="ts">
import type { PropType } from "vue";
import { useUid } from "~/logic/useUid";

const uid = useUid();
const props = defineProps({
  disabled: Boolean,
  label: String,
  modelValue: String,
  type: String as PropType<"text" | "email" | "password">,
  required: { type: Boolean, default: false },
});
</script>

<template>
  <div>
    <label v-if="props.label" class="w-full mb-2" :for="uid">{{ props.label }}</label>
    <input
      :id="uid"
      :type="props.type"
      :required="props.required"
      :placeholder="props.label"
      :disabled="disabled"
      class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:bg-gray-700 dark:text-gray-300 leading-tight focus:outline-none focus:shadow-outline disabled:opacity-80 disabled:cursor-not-allowed disabled:select-none"
      :value="props.modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  </div>
</template>
