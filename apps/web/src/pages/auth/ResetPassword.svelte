<script lang="ts">
  import { resetPassword } from "@/api";
  import { route } from "@/modules/router";
  import { handleError, handleInfo } from "@/utils";

  let email = $route?.query.email ?? $route?.query.user ?? "";
  let key = $route?.query.key ?? "";

  let password = "";
  let passwordConfirm = "";

  function handleSubmit() {
    if (password !== passwordConfirm) {
      handleError("The passwords don't match");
      return;
    }

    resetPassword({ email, resetKey: key, password }).then(() => handleInfo("Your password was reset"), handleError);
  }
</script>

<div class="goldfish container">
  <h1>Reset password</h1>

  <form method="post" accept-charset="UTF-8" role="form" class="clearfix" on:submit|preventDefault={handleSubmit}>
    <div class="form-group">
      <label for="email">Email</label>
      <input
        type="email"
        class="form-control"
        id="email"
        placeholder="Email address"
        bind:value={email}
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
          bind:value={passwordConfirm}
          placeholder="Password"
          required
        />
      </div>
    </div>
    <button type="submit" class="btn btn-primary pull-right mt-3">Reset</button>
  </form>
</div>
