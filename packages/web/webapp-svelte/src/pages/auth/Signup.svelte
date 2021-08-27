<script lang="ts">
  import { register, registerSocial } from "@/api";
  import Checkbox from "@/modules/cdk/Checkbox.svelte";
  import { route } from "@/modules/router";
  import { handleError } from "@/utils";
  import { upperFirst } from "lodash";
  
  let email = $route!.query.user ?? "";
  let isSocial = $route!.query.createSocialAccount;
  let provider = $route!.query.provider
  
  let password = "";
  let passwordConfirm = "";
  let username = "";
  let newsletter = false;
  let tc = false;

  function handleSubmit() {
    if (!tc) {
      handleError("You need to read and agree to the Terms and Conditions!");
      return;
    }

    if (isSocial) {
      const { jwt } = $route!.query;

      registerSocial({ username, termsAndConditions: tc, jwt }).catch(handleError);
    } else {
      if (password !== passwordConfirm) {
        handleError("The two passwords don't match");
        return;
      }

      register({ email, password, newsletter, username, termsAndConditions: tc }).catch(handleError);
    }
  }
</script>

<div class="signup container">
  <h1>Create an account</h1>
  <form method="post" on:submit|preventDefault={handleSubmit}>
    <div class="form-group">
      <label for="signup-username">Username</label>
      <input
        type="text"
        class="form-control"
        id="signup-username"
        name="username"
        placeholder="Username"
        aria-describedby="usernameHelp"
        bind:value={username}
        required
      />
      {#if isSocial}
        <small id="usernameHelp" class="form-text text-muted">
          You are signing up with <b class={`text-${provider}`}> {upperFirst(provider)}</b>. You still need to decide on
          a username to use on the site.
        </small>
      {/if}
    </div>
    {#if !isSocial}
      <div class="form-group">
        <label for="signup-email">Email address</label>
        <input
          type="email"
          class="form-control"
          id="signup-email"
          name="email"
          placeholder="Email"
          aria-describedby="emailHelp"
          bind:value={email}
          required
        />
        <small id="emailHelp" class="form-text text-muted">
          We will never share your email without <b>explicit</b> consent.
        </small>
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
            bind:value={password}
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
            placeholder="Password"
            bind:value={passwordConfirm}
            required
          />
        </div>
      </div>
      <Checkbox bind:checked={newsletter}>Get newsletter, up to six emails per year.</Checkbox>
    {/if}

    <Checkbox bind:checked={tc}>
      I have read and agree to the <a href="/page/terms-and-conditions" target="_blank">Terms and Conditions</a>.
    </Checkbox>

    <button id="signup-button" class="btn btn-primary pull-right mt-3" type="submit">Register</button>
  </form>

  <hr />

  <p>Already have an account? <a href="/login">Log in</a></p>
  <p>Or head <a href="/">home</a>.</p>
</div>
