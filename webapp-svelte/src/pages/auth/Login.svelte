<script lang="ts">
  import { login } from "@/api";
  import { Button, FormGroup, Label } from "@/modules/cdk";
  import { handleError } from "@/utils";
  
  let email = "";
  let password = "";

  function handleLogin() {
    login(email, password).catch(handleError);
  }
</script>

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
    <div class="text-right mt-1">
      <router-link to="/forgotten-password"><small>Forgotten password ?</small></router-link>
    </div>
  </FormGroup>
  <Button type="submit" color="primary" class="pull-right">Login</Button>
</form>

<hr />

<p>Need an account ? <router-link to="/signup">Register</router-link></p>
