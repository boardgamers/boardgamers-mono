<template>
  <div class="signup container">
    <h1>Create an account</h1>
    <form method="post" @submit.prevent="submit" class="clearfix">
      <div class="form-group">
        <label for="signup-username">Username</label>
        <input
          type="text"
          class="form-control"
          id="signup-username"
          name="username"
          placeholder="Username"
          aria-describedby="usernameHelp"
          v-model.trim="username"
          required
        />
        <small id="usernameHelp" class="form-text text-muted" v-if="isSocial"
          >You are signing up with <b :class="`text-${provider}`"> {{ provider | upperFirst }}</b
          >. You still need to decide on a username to use on the site.</small
        >
      </div>
      <div class="form-group" v-if="!isSocial">
        <label for="signup-email">Email address</label>
        <input
          type="email"
          class="form-control"
          id="signup-email"
          name="email"
          placeholder="Email"
          aria-describedby="emailHelp"
          v-model.trim="email"
          required
        />
        <small id="emailHelp" class="form-text text-muted"
          >We will never share your email without <b>explicit</b> consent.</small
        >
      </div>
      <div class="form-row" v-if="!isSocial">
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
        <div class="form-group col-md-6" v-if="!isSocial">
          <label for="signup-password-confirm">Confirm <span class="d-md-none">password</span></label>
          <input
            type="password"
            class="form-control"
            id="signup-password-confirm"
            name="password-confirm"
            placeholder="Password"
            v-model="passwordConfirm"
            required
          />
        </div>
      </div>

      <b-checkbox v-model="newsletter" v-if="!isSocial"> Get newsletter, up to six emails per year. </b-checkbox>

      <b-checkbox v-model="tc">
        I have read and agree to the <a href="/page/terms-and-conditions" target="_blank">Terms and Conditions</a>.
      </b-checkbox>

      <button id="signup-button" class="btn btn-primary pull-right mt-3" type="submit">Register</button>
    </form>

    <hr />

    <p>Already have an account? <router-link to="/login">Log in</router-link></p>
    <p>Or head <router-link to="/">home</router-link>.</p>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError } from "@/utils";

@Component({
  mounted() {
    this.email = this.$route.query.user;
  },
})
export default class Signup extends Vue {
  submit() {
    if (!this.tc) {
      handleError("You need to read and agree to the Terms and Conditions!");
      return;
    }

    if (this.isSocial) {
      const { username, tc } = this;
      const { jwt } = this.$route.query;

      this.$axios.post("/account/signup/social", { username, termsAndConditions: tc, jwt }).then(
        ({ data }) => this.$store.dispatch("updateAuth", data),
        (err) => handleError(err)
      );
    } else {
      if (this.password !== this.passwordConfirm) {
        handleError("The two passwords don't match");
        return;
      }

      const { email, password, newsletter, username, tc } = this;

      this.$axios.post("/account/signup", { email, username, password, newsletter, termsAndConditions: tc }).then(
        ({ data }) => this.$store.dispatch("updateAuth", data),
        (err) => handleError(err)
      );
    }
  }

  get isSocial() {
    return this.$route.query.createSocialAccount;
  }

  get provider() {
    return this.$route.query.provider;
  }

  password = "";
  passwordConfirm = "";
  email = "";
  username = "";
  newsletter = false;
  tc = false;
}
</script>
