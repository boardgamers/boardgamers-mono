<script setup lang="ts">
import { useUid } from "~/logic/useUid";

const uid = useUid();
const props = defineProps<{
  disabled?: boolean;
  label?: string;
  modelValue?: string;
  multiple?: boolean;
  required?: boolean;
  items: Array<{text: string; value: string}>;
}>();

const valueToSrc = computed(() => Object.fromEntries(props.items.map(item => [item.value, item.value])));

function getInput(elem: HTMLSelectElement) {
  if (!props.multiple) {
    return elem.value;
  }

  return new Array(elem.children.length).fill(0).map((_, i) => elem.children[i] as HTMLOptionElement).filter(elem => elem.selected).map(elem => valueToSrc.value[elem.value]);
}
</script>

<template>
  <div>
    <label v-if="props.label" class="w-full mb-2" :for="uid">{{ props.label }}</label>
    <select
      :id="uid"
      :required="props.required"
      :placeholder="props.label"
      :disabled="disabled"
      :multiple="multiple"
      class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:bg-gray-700 dark:text-gray-300 leading-tight focus:outline-none focus:shadow-outline disabled:opacity-80 disabled:cursor-not-allowed disabled:select-none"
      :[!multiple&&`value`]="props.modelValue"
      @input="$emit('update:modelValue', getInput($event.target))"
    >
      <option
        v-for="item in items"
        :key="item.value"
        :value="item.value"
        :[multiple&&`selected`]="modelValue?.includes(item.value)"
      >
        {{ item.text }}
      </option>
    </select>
  </div>
</template>
