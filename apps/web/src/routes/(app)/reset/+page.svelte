<script lang="ts">
  import { page } from "$app/stores";
  import { SEO } from "@/components";
  import { Button } from "@/modules/cdk";
  import { setAuthData, type AuthData } from "@/lib/auth.svelte";
  import { post } from "@/lib/api";
  import { handleError, handleInfo } from "@/utils";

  async function resetPassword(params: { email: string; resetKey: string; password: string }): Promise<void> {
    return post<AuthData>("/account/reset", params).then(setAuthData);
  }

  let email = $state($page.url.searchParams.get("email") ?? $page.url.searchParams.get("user") ?? "");
  let key = $state($page.url.searchParams.get("key")!);
  let password = $state("");
  let passwordConfirm = $state("");

  function handleSubmit() {
    if (password !== passwordConfirm) {
      handleError("The passwords don't match");
      return;
    }
    resetPassword({ email, resetKey: key, password }).then(() => handleInfo("Your password was reset"), handleError);
  }
</script>

<SEO title="Reset password" />
<div class="container mx-auto px-4">
  <h1>Reset password</h1>
  <form
    method="post"
    accept-charset="UTF-8"
    onsubmit={(e) => { e.preventDefault(); handleSubmit(e); }}
  >
    <div class="mb-3">
      <label for="email">Email</label>
      <input
        type="email"
        class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
        id="email"
        placeholder="Email address"
        bind:value={email}
        disabled
        required
      />
    </div>
    <div class="flex flex-row gap-3">
      <div class="mb-3 flex-1">
        <label for="signup-password">Password</label>
        <input
          type="password"
          class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          id="signup-password"
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
          bind:value={passwordConfirm}
          placeholder="Password"
          required
        />
      </div>
    </div>
    <Button type="submit" color="primary" class="mt-3 ml-auto">Reset</Button>
  </form>
</div>
