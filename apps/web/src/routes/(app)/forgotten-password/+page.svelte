<script lang="ts">
  import { SEO } from "@/components";
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
<div class="goldfish container">
  <h1>Forgotten password</h1>
  <form method="post" accept-charset="UTF-8" role="form" onsubmit={(e) => { e.preventDefault(); handleSubmit(e); }}>
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" class="form-control" id="email" placeholder="Email address" bind:value={email} required />
    </div>
    <button type="submit" class="btn btn-primary pull-right mt-3">Reset</button>
  </form>
  <hr />
  <p>Need an account? <a href="/signup">Register</a></p>
  <p>Or go back <a href="/">home</a>.</p>
</div>
