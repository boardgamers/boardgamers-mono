<script setup lang="ts">
import { useUid } from "~/logic/useUid";

const uid = useUid();
const props = defineProps<{
  required?: boolean;
  label?: string;
  modelValue: string;
}>();
</script>

<template>
  <label v-if="props.label" class="w-full mb-2" :for="uid">{{ props.label }}</label>
  <textarea
    :id="uid"
    :required="props.required"
    :placeholder="props.label"
    class="
      shadow
      appearance-none
      border
      rounded
      w-full
      py-2
      px-3
      text-gray-700
      dark:bg-gray-700 dark:text-gray-300
      leading-tight
      focus:outline-none focus:shadow-outline
      min-h-32
      flex-1
    "
    :value="props.modelValue"
    @input="$emit('update:modelValue', $event.target.value)"
  />
</template>
