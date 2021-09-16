<script setup lang="ts">
import { useUid } from "~/logic/useUid";

const uid = useUid();
const props = defineProps<{
  disabled?: boolean;
  label?: string;
  modelValue: boolean;
  required?: boolean;
}>();
</script>

<template>
  <div>
    <input
      :id="uid"
      :required="props.required"
      :placeholder="props.label"
      :disabled="disabled"
      class="cursor-pointer disabled:cursor-not-allowed"
      type="checkbox"
      :checked="props.modelValue"
      @input="$emit('update:modelValue', $event.target.value === 'on')"
    />
    <label v-if="props.label" class="w-full ml-2 cursor-pointer disabled:cursor-not-allowed" :for="uid">{{
      props.label
    }}</label>
  </div>
</template>
