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

<div class="container mx-auto px-4">
<form onsubmit={(e) => { e.preventDefault(); handleLogin(e); }}>
  <FormGroup>
    <Label for="email">Email</Label>
    <input
      bind:value={email}
      type="email"
      class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
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
      class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
      id="password"
      name="password"
      placeholder="Password"
      bind:value={password}
      required
    />
    <div class="mt-1 text-right">
      <a href="/forgotten-password"><span class="text-xs">Forgotten password ?</span></a>
    </div>
  </FormGroup>
  <Button type="submit" color="primary" class="ml-auto">Login</Button>
</form>

<hr />

<p>Need an account ? <a href="/signup">Register</a></p>
</div>
