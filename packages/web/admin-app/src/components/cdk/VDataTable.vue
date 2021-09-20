<script setup lang="ts">
import { get } from "lodash";

const selected = ref<any>();

withDefaults(defineProps<{headers: Array<{text: string; value: any}>; items: Array<Record<string, any>>; itemKey?: string}>(), { itemKey: 'value' });
</script>
<template>
  <table class="w-full border rounded table-fixed">
    <tr>
      <th v-for="item in headers" :key="item.value" class="px-2 border">
        {{ item.text }}
      </th>
    </tr>
    <template v-for="item in items" :key="item[itemKey]">
      <tr :class="{'cursor-pointer': $slots['expanded-item']}" @click="selected === item[itemKey] ? selected = undefined : selected = item[itemKey]">
        <td v-for="header in headers" :key="header.value" class="px-2 border">
          {{ get(item, header.value) }}
        </td>
      </tr>
      <tr v-if="$slots['expanded-item'] && selected === item[itemKey]">
        <slot name="expanded-item" :item="item" />
      </tr>
    </template>
  </table>
</template>
