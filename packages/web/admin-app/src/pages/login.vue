<script setup lang="ts">
import { reactive } from "vue-demi";
import { post } from "~/api/rest";
import { handleError } from "~/utils";

const form = reactive({
  email: "",
  password: "",
});

async function login() {
  try {
    const data = await post("/account/login", { email: form.email, password: form.password });
    // this.$store.dispatch("updateAuth", data);
  }
  catch (err) {
    handleError(err);
  }
}
</script>

<template>
  <form @submit.prevent="login">
    <v-text-field v-model="form.email" label="Email" required type="email" />
    <v-text-field v-model="form.password" label="Password" required type="password" />
    <v-btn color="primary" type="submit"> Log in </v-btn>
  </form>
</template>
