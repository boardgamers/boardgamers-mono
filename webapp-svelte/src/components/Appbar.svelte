<script lang="ts">
import {
  Navbar,
  NavbarBrand,
  Nav,
  NavItem,
  UncontrolledDropdown,
  DropdownToggle,
  DropdownMenu,
  Button,
  Input,
  Form,
  FormGroup,
  Label,
  FormText
} from 'sveltestrap';

let user = false;

</script>

<Navbar color="primary" dark expand>
  <!-- todo: reload game lists if on same page -->
  <NavbarBrand href="/">BGS</NavbarBrand>
  <!-- todo: mobile-only boardgame list -->

  <Nav class="ml-auto" navbar>
    {#if !user}
      <!-- todo: hide on mobile -->
      <NavItem>
        <span class="navbar-text">Have an account?</span>
      </NavItem>
      <UncontrolledDropdown nav inNavbar>
        <DropdownToggle nav caret>Login</DropdownToggle>
        <DropdownMenu right class="login-dp">
          <div class="row">
            <div class="col-md-12">
              Log in with
              <div class="social-buttons">
                <Button href="/api/account/auth/google" class="google">Google</Button>
                <Button href="/api/account/auth/discord" class="discord">Discord</Button>
                <Button href="/api/account/auth/facebook" class="facebook">Facebook</Button>
              </div>
              or
              <Form class="mt-3">
                <FormGroup>
                  <Label hidden for="email">Email</Label>
                  <Input id="email" type="email" required autofocus />
                </FormGroup>
                <FormGroup>
                  <Label hidden for="password">Password</Label>
                  <Input id="password" type="password" required />
                  <FormText class="mt-2 pt-2">
                    <a href="/forgotten-password">Forgotten password ?</a>
                  </FormText>
                </FormGroup>
                <FormGroup>
                  <Button type="submit" color="primary" block>Log in</Button>
                </FormGroup>
              </Form>
            </div>
            <div class="bottom text-center bg-red-300">
              New ? <a href="/signup"><b>Join us</b></a>
            </div>
          </div>
        </DropdownMenu>
      </UncontrolledDropdown>
    {:else}{/if}
  </Nav>
</Navbar>

<style lang="postcss" global>
  .login-dp {
    min-width: 250px;
    padding: 14px 14px 0;
    margin-top: 8px;
    overflow: hidden;
    background-color: rgba(255, 255, 255, 0.8);

    .bottom {
      border-top: 1px solid #ddd;
      clear: both;
      padding: 14px;
    }

    .social-buttons {
      display: flex;
      justify-content: space-around;
      flex-wrap: wrap;
      margin-top: 12px;
      margin-bottom: 4px;

      a {
        width: 46%;
        margin-bottom: 8px;
      }

      .google {
        background-color: #d74a38 !important;
        border-color: #d74a38 !important;
      }

      .facebook {
        background-color: #3a63bf;
        border-color: #3a63bf;
      }

      .discord {
        background-color: #7289da;
        border-color: #7289da;
      }
    }
  }
</style>
