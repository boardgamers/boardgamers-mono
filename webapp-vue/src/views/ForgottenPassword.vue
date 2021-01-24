<template>
  <div class="goldfish container">
    <h1>Forgotten password</h1>

    <form method="post" accept-charset="UTF-8" role="form" class="clearfix" @submit.prevent="submit">
      <div class="form-group">
        <label for="email">Email</label>
        <input
          type="email"
          class="form-control"
          id="email"
          name="email"
          placeholder="Email address"
          v-model="email"
          required
        />
      </div>
      <button type="submit" class="btn btn-primary pull-right mt-3">Reset</button>
    </form>

    <hr />

    <p>Need an account? <router-link to="/signup">Register</router-link></p>
    <p>Or go back <router-link to="/">home</router-link>.</p>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError, handleInfo } from "@/utils";

@Component
export default class ForgottenPassword extends Vue {
  email = "";

  submit() {
    this.$axios.post("/account/forget", { email: this.email }).then(
      () => handleInfo("An email was sent to reset your password"),
      (err) => handleError(err)
    );
  }
}
</script>
