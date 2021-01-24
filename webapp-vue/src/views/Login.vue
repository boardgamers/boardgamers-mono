<template>
  <div class="login container">
    <h1>Log in</h1>

    <!-- LOGIN FORM -->
    <form method="post" accept-charset="UTF-8" role="form" class="clearfix" @submit.prevent="login">
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
      <div class="form-group">
        <label for="password">Password</label>
        <input
          type="password"
          class="form-control"
          id="password"
          name="password"
          placeholder="Password"
          v-model="password"
          required
        />
        <div class="text-right mt-1">
          <router-link to="/forgotten-password"><small>Forgotten password ?</small></router-link>
        </div>
      </div>
      <button type="submit" class="btn btn-primary pull-right">Login</button>
    </form>

    <hr />

    <p>Need an account ? <router-link to="/signup">Register</router-link></p>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError } from "@/utils";

@Component
export default class Login extends Vue {
  email = "";
  password = "";

  login() {
    this.$axios.post("/account/login", { email: this.email, password: this.password }).then(
      ({ data }) => {
        this.$store.dispatch("updateAuth", data);
      },
      (err) => handleError(err)
    );
  }
}
</script>
