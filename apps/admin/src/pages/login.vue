<script setup lang="ts">
import { post } from "~/api/rest";
import { handleError } from "~/utils";
import VTextField from "~cdk/VTextField.vue";
import VBtn from "~cdk/VBtn.vue";
import { useUserStore } from "~/store/user";

const user = useUserStore();
const route = useRoute();
const router = useRouter();

const form = reactive({
  email: "",
  password: "",
});

function leave() {
  if (route.query.redirect) {
    router.push(route.query.redirect as string);
  } else {
    router.push("/");
  }
}

async function login() {
  try {
    const data = await post("/account/login", { email: form.email, password: form.password });
    user.updateAuth(data);
  } catch (err) {
    handleError(err);
  }
}

whenever(() => !!user.user, leave, { immediate: true });
</script>

<template>
  <form @submit.prevent="login">
    <v-text-field v-model="form.email" label="Email" required type="email" class="my-2" />
    <v-text-field v-model="form.password" label="Password" required type="password" class="my-2" />
    <v-btn type="submit" class="my-1 float-right"> Log in </v-btn>
  </form>
</template>

<route lang="yaml">
name: login
meta:
  requiresAuth: false
</route>
