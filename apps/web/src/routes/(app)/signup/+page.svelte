<script lang="ts">
  import { page } from "$app/stores";
  import { SEO } from "@/components";
  import { Button } from "@/modules/cdk";
  import { setAuthData, type AuthData } from "@/lib/auth.svelte";
  import { useLoggedOut } from "@/lib/auth-guards.svelte";
  import { post } from "@/lib/api";
  import Checkbox from "@/modules/cdk/Checkbox.svelte";
  import { handleError } from "@/utils";
  import { upperFirst } from "lodash";

  useLoggedOut();

  let email = $state($page.url.searchParams.get("user") ?? "");
  let isSocial = $page.url.searchParams.get("createSocialAccount");
  let provider = $page.url.searchParams.get("provider")!;

  let password = $state("");
  let passwordConfirm = $state("");
  let username = $state("");
  let newsletter = $state(false);
  let tc = $state(false);

  async function register(params: {
    email: string;
    username: string;
    password: string;
    newsletter: boolean;
    termsAndConditions: boolean;
  }): Promise<void> {
    return post<AuthData>("/account/signup", params).then(setAuthData);
  }

  async function registerSocial(params: { jwt: string; username: string; termsAndConditions: boolean }): Promise<void> {
    return post<AuthData>("/account/signup/social", params).then(setAuthData);
  }

  function handleSubmit() {
    if (!tc) {
      handleError("You need to read and agree to the Terms and Conditions!");
      return;
    }

    if (isSocial) {
      const jwt = $page.url.searchParams.get("jwt")!;

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

<SEO title="Create an account" />

<div class="container mx-auto px-4">
  <h1>Create an account</h1>
  <form method="post" onsubmit={(e) => { e.preventDefault(); handleSubmit(e); }}>
    <div class="mb-3">
      <label for="signup-username">Username</label>
      <input
        type="text"
        class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
        id="signup-username"
        name="username"
        placeholder="Username"
        aria-describedby="usernameHelp"
        bind:value={username}
        required
      />
      {#if isSocial}
        <small id="usernameHelp" class="text-xs text-gray-500 dark:text-gray-400">
          You are signing up with <b class={`text-${provider}`}> {upperFirst(provider)}</b>. You still need to decide on
          a username to use on the site.
        </small>
      {/if}
    </div>
    {#if !isSocial}
      <div class="mb-3">
        <label for="signup-email">Email address</label>
        <input
          type="email"
          class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          id="signup-email"
          name="email"
          placeholder="Email"
          aria-describedby="emailHelp"
          bind:value={email}
          required
        />
        <small id="emailHelp" class="text-xs text-gray-500 dark:text-gray-400">
          We will never share your email without <b>explicit</b> consent.
        </small>
      </div>
      <div class="flex flex-row gap-3">
        <div class="mb-3 flex-1">
          <label for="signup-password">Password</label>
          <input
            type="password"
            class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            id="signup-password"
            name="password"
            placeholder="Password"
            bind:value={password}
            required
          />
        </div>
        <div class="mb-3 flex-1">
          <label for="signup-password-confirm">Confirm <span class="md:hidden">password</span></label>
          <input
            type="password"
            class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
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

    <Button id="signup-button" class="mt-3 ml-auto" type="submit" color="primary">Register</Button>
  </form>

  <hr />

  <p>Already have an account? <a href="/login">Log in</a></p>
  <p>Or head <a href="/">home</a>.</p>
</div>
