
<Navbar color="light" light expand>
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
                <Button href="/api/account/auth/google" variant="google">Google</Button>
                <Button href="/api/account/auth/discord" variant="discord">Discord</Button>
                <Button href="/api/account/auth/facebook" variant="facebook">Facebook</Button>
              </div>
              or
            </div>
            <div class="bottom text-center">
              New ? <a href="/signup"><b>Join us</b></a>
            </div>
          </div>
        </DropdownMenu>
      </UncontrolledDropdown>
    {:else}
    {/if}
  </Nav>
</Navbar>

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
  Form,
  FormGroup
} from 'sveltestrap';

let user = false;

</script>

<style type="text/scss" global>
  .login-dp {
    min-width: 250px;
    padding: 14px 14px 0;
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
    }
  }
</style>