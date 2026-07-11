<script lang="ts">
  import { Button, FormGroup, Label } from "@/modules/cdk";
  import { handleError } from "@/utils";
  import { useLoggedOut } from "@/lib/auth-guards.svelte";
  import { redirectLoggedOut } from "@/utils/redirect";
  import { SEO } from "@/components";
  import { login } from "@/lib/account.svelte";

  useLoggedOut();

  let email = $state("");
  let password = $state("");

  function handleLogin() {
    login(email, password).catch(handleError);
  }
</script>

<SEO title="Login" />

<form onsubmit={(e) => { e.preventDefault(); handleLogin(e); }}>
  <FormGroup>
    <Label for="email">Email</Label>
    <input
      bind:value={email}
      type="email"
      class="form-control"
      id="email"
      name="email"
      placeholder="Email address"
      required
    />
  </FormGroup>
  <FormGroup>
    <Label for="password">Password</Label>
    <input
      type="password"
      class="form-control"
      id="password"
      name="password"
      placeholder="Password"
      bind:value={password}
      required
    />
    <div class="text-end mt-1">
      <a href="/forgotten-password"><small>Forgotten password ?</small></a>
    </div>
  </FormGroup>
  <Button type="submit" color="primary" class="pull-right">Login</Button>
</form>

<hr />

<p>Need an account ? <a href="/signup">Register</a></p>
