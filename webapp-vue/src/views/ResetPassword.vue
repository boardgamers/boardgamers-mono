<template>
  <div class="goldfish container">
    <h1>Reset password</h1>

    <form method="post" accept-charset="UTF-8" role="form" class="clearfix" @submit.prevent="submit">
      <div class="form-group">
        <label for="email">Email</label>
        <input
          type="email"
          class="form-control"
          id="email"
          name="email"
          placeholder="Email address"
          :value="email"
          disabled
          required
        />
      </div>
      <div class="form-row">
        <div class="form-group col-md-6">
          <label for="signup-password">Password</label>
          <input
            type="password"
            class="form-control"
            id="signup-password"
            name="password"
            placeholder="Password"
            v-model="password"
            required
          />
        </div>
        <div class="form-group col-md-6">
          <label for="signup-password-confirm">Confirm <span class="d-md-none">password</span></label>
          <input
            type="password"
            class="form-control"
            id="signup-password-confirm"
            name="password-confirm"
            v-model="passwordConfirm"
            placeholder="Password"
            required
          />
        </div>
      </div>
      <button type="submit" class="btn btn-primary pull-right mt-3">Reset</button>
    </form>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError, handleInfo } from "@/utils";
import Router, { Route, Location } from "vue-router";

@Component<ResetPassword>({
  created() {
    this.email = this.$route.query.email || this.$route.query.user;
    this.key = this.$route.query.key;
  },
})
export default class ResetPassword extends Vue {
  email = "";
  key = "";
  password = "";
  passwordConfirm = "";

  submit() {
    if (this.password !== this.passwordConfirm) {
      handleError("The passwords don't match");
      return;
    }

    this.$axios.post("/account/reset", { email: this.email, resetKey: this.key, password: this.password }).then(
      ({ data }) => {
        handleInfo("Your password was reset");
        this.$store.dispatch("updateAuth", data);
      },
      (err) => handleError(err)
    );
  }
}
</script>
