<script setup lang="ts">

const [open, setOpen] = useToggle(false);
</script>

<template>
  <v-list-item :selected="open" @click="setOpen(!open)">
    <slot name="activator" />

    <v-list-item-icon class="ml-auto">
      <carbon-chevron-down v-if="!open" />
      <carbon-chevron-up v-else />
    </v-list-item-icon>
  </v-list-item>
  <slot v-if="open" />
</template>
