<template>
  <div class="border-dark-50 border-2 rounded flex flex-col">
    <div v-if="$slots.title" class="text-lg p-2 bg-gray-600 text-white">
      <slot name="title" />
    </div>
    <div class="flex-grow p-2">
      <slot />
    </div>
    <template v-if="$slots.actions">
      <hr />
      <div v-if="$slots.actions" class="p-2 flex flex-row gap-2">
        <slot name="actions" />
      </div>
    </template>
  </div>
</template>
