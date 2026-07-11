<script lang="ts">
  import { SEO } from "@/components";
  import { Button } from "@/modules/cdk";
  import { useLoggedOut } from "@/lib/auth-guards.svelte";
  import { post } from "@/lib/api";
  import { handleError, handleInfo } from "@/utils";

  useLoggedOut();
  let email = $state("");
  function handleSubmit() {
    post("/account/forget", { email }).then(() => handleInfo("An email was sent to reset your password"), handleError);
  }
</script>

<SEO title="Forgotten password" />
<div class="container mx-auto px-4">
  <h1>Forgotten password</h1>
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
        required
      />
    </div>
    <Button type="submit" color="primary" class="mt-3 ml-auto">Reset</Button>
  </form>
  <hr />
  <p>Need an account? <a href="/signup">Register</a></p>
  <p>Or go back <a href="/">home</a>.</p>
</div>
