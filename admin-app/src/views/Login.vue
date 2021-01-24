<template>
  <form @submit.prevent="login">
    <v-text-field label="Email" required v-model="form.email" type="email" />
    <v-text-field label="Password" required v-model="form.password" type="password" />
    <v-btn color="primary" type="submit">Log in</v-btn>
  </form>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError } from "@/utils";

@Component
export default class Login extends Vue {
  form = {
    email: "",
    password: "",
  };

  login() {
    this.$axios.post("/account/login", { email: this.form.email, password: this.form.password }).then(
      ({ data }) => {
        this.$store.dispatch("updateAuth", data);
      },
      (err) => handleError(err)
    );
  }
}
</script>
