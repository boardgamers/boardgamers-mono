<script context="module" lang="ts">
  import { useAccount } from "@/composition/useAccount";
  import { useLoad } from "@/composition/useLoad";
  import { useRefreshToken } from "@/composition/useRefreshToken";
  import { get as storeGet } from "svelte/store";

  import type { LoadInput } from "@sveltejs/kit";

  export const ssr = false; // for refresh token query param

  export async function load(input: LoadInput) {
    const { account, refreshToken, loadAccount } = useLoad(input, useAccount, useRefreshToken);

    if (input.page.query.get("refreshToken")) {
      refreshToken.set(JSON.parse(input.page.query.get("refreshToken")!));

      await loadAccount(true);
    }

    if (storeGet(account)) {
      return {
        redirect: redirectLoggedOut(input.page),
        status: 302,
      };
    }

    return {};
  }
</script>

<script lang="ts">
  import { Button, FormGroup, Label } from "@/modules/cdk";
  import { handleError } from "@/utils";
  import { useLoggedOut } from "@/composition/useLoggedOut";
  import { redirectLoggedOut } from "@/utils/redirect";
  import { SEO } from "@/components";

  useLoggedOut();

  const { login } = useAccount();

  let email = "";
  let password = "";

  function handleLogin() {
    login(email, password).catch(handleError);
  }
</script>

<SEO title="Login" />

<form on:submit|preventDefault={handleLogin}>
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
