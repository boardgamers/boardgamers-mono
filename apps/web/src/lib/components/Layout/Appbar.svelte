<script lang="ts">
  import { browser } from "$app/environment";
  import { useAccount } from "$lib/composition/useAccount";
  import { useActiveGames } from "$lib/composition/useActiveGames";
  import { useLogoClicks } from "$lib/composition/useLogoClicks";
  import { handleError } from "$lib/utils/handle-stuff";
  import IconGearFill from "@iconify-svelte/bi/gear-fill";
  import IconPower from "@iconify-svelte/bi/power";
  import {
    Button,
    Dropdown,
    DropdownMenu,
    DropdownToggle,
    Form,
    FormGroup,
    FormText,
    Input,
    Label,
    Nav,
    Navbar,
    NavLink,
  } from "@sveltestrap/sveltestrap";
  import UserAvatar from "../User/UserAvatar.svelte";

  const { account: user, login, logout } = useAccount();
  const { logoClick } = useLogoClicks();
  const { activeGames } = useActiveGames();

  let email = "";
  let password = "";
  let className = "";
  let admin: boolean;
  let hasGames: boolean;

  export { className as class };

  const handleSubmit = (event: Event) => {
    event.preventDefault();

    login(email, password).catch(handleError);
  };

  const logOut = () => {
    logout().catch(handleError);
  };

  $: admin = $user?.authority === "admin";
  // todo use load() function of svelte kit instead
  // $: adminLink =
  //   location.hostname === "localhost"
  //     ? "http://localhost:8613"
  //     : `${location.protocol}//admin.${location.hostname.slice(location.hostname.indexOf(".") + 1)}`;
  const adminLink = "https://admin.boardgamers.space";
  $: hasGames = $activeGames.length > 0;

  const onHasGamesChanged = () => {
    if (hasGames) {
      if (document.hidden) {
        if ($user?.settings?.game?.soundNotification) {
          (document.getElementById("sound-notification") as HTMLAudioElement).play();
        }
        if (localStorage.getItem("notifications")) {
          new Notification("Boardgamers 🌌", { icon: "/favicon-active.ico", body: "It's your turn!" });
        }
      }
    }
  };

  $: (browser && onHasGamesChanged(), [hasGames]);
</script>

<Navbar color="primary" class={className} dark expand>
  <a href="/" onclick={logoClick} sveltekit:prefetch class="navbar-brand">BGS</a>

  {#if $user}
    <a
      class="btn btn-sm me-3"
      class:btn-success={hasGames}
      class:btn-secondary={!hasGames}
      href="/next-game"
      title="Jump to next active game"
      id="active-game-count"
    >
      {$activeGames.length}
    </a>
  {/if}

  <a href="/boardgames" title="Boardgames list" sveltekit:prefetch>
    <img src="/images/icons/dice.svg" height="28" width="28" alt="Boardgames list" />
  </a>

  <audio preload="none" id="sound-notification">
    <source src="/audio/notification.mp3" type="audio/mpeg" />
    <source src="/audio/notification.ogg" type="audio/ogg" />
  </audio>

  <Nav class="ms-auto" navbar>
    {#if !$user}
      <!-- todo: hide on mobile -->
      <span class="navbar-text">Have an account?</span>
      <Dropdown nav inNavbar>
        <DropdownToggle nav caret>Login</DropdownToggle>
        <DropdownMenu right class="login-dp">
          <div class="row">
            <div class="col-md-12">
              Log in with
              <div class="social-buttons">
                <Button href="/api/account/auth/google" rel="external" class="google">Google</Button>
                <Button href="/api/account/auth/discord" rel="external" class="discord">Discord</Button>
                <Button href="/api/account/auth/facebook" rel="external" class="facebook">Facebook</Button>
              </div>
              or
              <Form class="mt-3" onsubmit={handleSubmit}>
                <FormGroup>
                  <Label hidden for="email">Email</Label>
                  <Input id="email" type="email" required bind:value={email} autofocus />
                </FormGroup>
                <FormGroup>
                  <Label hidden for="password">Password</Label>
                  <Input id="password" type="password" bind:value={password} required />
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
      </Dropdown>
    {:else}
      {#if admin}
        <NavLink href={adminLink} class="d-flex" style="align-items: center; gap: 0.5em">
          <IconGearFill class="big" />
          <span class="d-none d-sm-inline">Admin</span>
        </NavLink>
      {/if}
      <NavLink href={`/user/${$user.account.username}`} sveltekit:prefetch class="appbar-user-link">
        <UserAvatar username={$user.account.username} userId={$user._id} size="2rem" />
        <span class="d-none d-sm-inline">{$user.account.username}</span>
      </NavLink>
      <NavLink onclick={logOut} class="d-flex" style="align-items: center; gap: 0.5em">
        <IconPower class="big" />
        <span class="d-none d-sm-inline">Log out</span>
      </NavLink>
    {/if}
  </Nav>
</Navbar>

<style lang="postcss" global>
  .appbar-user-link {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    display: flex !important;
    gap: 0.5rem;
    align-items: center;
  }
  .login-dp {
    min-width: 250px !important;
    padding: 14px 14px 0 !important;
    margin-top: 8px !important;
    overflow: hidden;
    right: 0;
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

  #active-game-count {
    border-radius: 50%;
    padding: 0.1rem 0.5rem;
  }
</style>
