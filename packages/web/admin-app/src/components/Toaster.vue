<script setup lang="ts">
import { ref } from "vue-demi";
import { notifications } from "~/events/notifications";

const message = ref("");
const show = ref(false);
const color = ref<"info"|"success"|"error">("info");

notifications.on((payload) => {
  message.value = payload.message;
  show.value = true;
  color.value = payload.type;
});
</script>

<template>
  <v-snackbar v-model="show" top :color="color">
    {{ message }}
  </v-snackbar>
</template>
