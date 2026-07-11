<script lang="ts">
  import {
    Navbar,
    Nav,
    Dropdown,
    DropdownToggle,
    DropdownMenu,
    Button,
    Input,
    Form,
    FormGroup,
    Label,
    FormText,
    NavLink,
    Icon,
  } from "@/modules/cdk";
  import gearFill from "@iconify/icons-bi/gear-fill.js";
  import power from "@iconify/icons-bi/power.js";
  import sunFill from "@iconify/icons-bi/sun-fill.js";
  import moonFill from "@iconify/icons-bi/moon-fill.js";
  import circleHalf from "@iconify/icons-bi/circle-half.js";
  import { handleError } from "@/utils";
  import { account as user, login, logout } from "@/lib/account.svelte";
  import { logoClick } from "@/lib/stores.svelte";
  import { activeGames } from "@/lib/stores.svelte";
  import { browser } from "$app/environment";
  import { currentTheme, cycleTheme, type Theme } from "@/lib/theme.svelte";
  import UserAvatar from "../User/UserAvatar.svelte";

  const themeIcon: Record<Theme, any> = {
    light: sunFill,
    dark: moonFill,
    system: circleHalf,
  };
  const themeLabel: Record<Theme, string> = {
    light: "Light",
    dark: "Dark",
    system: "System",
  };

  let { class: className = "", ...rest } = $props();
  let email = $state("");
  let password = $state("");

  const handleSubmit = (event: Event) => {
    event.preventDefault();

    login(email, password).catch(handleError);
  };

  const logOut = () => {
    logout().catch(handleError);
  };

  let admin = $derived($user?.authority === "admin");
  // todo use load() function of svelte kit instead
  // $: adminLink =
  //   location.hostname === "localhost"
  //     ? "http://localhost:8613"
  //     : `${location.protocol}//admin.${location.hostname.slice(location.hostname.indexOf(".") + 1)}`;
  const adminLink = "https://admin.boardgamers.space";
  let hasGames = $derived($activeGames.length > 0);

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

  $effect(() => {
    hasGames;
    if (browser) onHasGamesChanged();
  });
</script>

<Navbar color="primary" class={className} dark expand>
  <a
    href="/"
    onclick={logoClick}
    data-sveltekit-preload-data="hover"
    class="me-2 text-xl font-bold text-white no-underline hover:text-white"
  >BGS</a>

  {#if $user}
    <a
      class={`me-3 rounded-full px-2 py-0.5 text-sm font-semibold text-white ${
        hasGames ? "bg-green-600" : "bg-gray-500"
      }`}
      href="/next-game"
      title="Jump to next active game"
      id="active-game-count"
    >
      {$activeGames.length}
    </a>
  {/if}

  <a href="/boardgames" title="Boardgames list" data-sveltekit-preload-data="hover">
    <img src="/images/icons/dice.svg" height="28" width="28" alt="Boardgames list" />
  </a>

  <audio preload="none" id="sound-notification">
    <source src="/audio/notification.mp3" type="audio/mpeg" />
    <source src="/audio/notification.ogg" type="audio/ogg" />
  </audio>

  <Nav class="ms-auto" navbar>
    <button
      onclick={cycleTheme}
      title={`Theme: ${themeLabel[$currentTheme]}`}
      class="me-2 flex items-center gap-1 rounded-md px-2 py-1 text-white hover:bg-white/10"
    >
      <Icon icon={themeIcon[$currentTheme]} inline={true} class="text-lg" />
      <span class="hidden sm:inline">{themeLabel[$currentTheme]}</span>
    </button>

    {#if !$user}
      <!-- todo: hide on mobile -->
      <span class="text-white">Have an account?</span>
      <Dropdown nav inNavbar>
        <DropdownToggle nav caret>Login</DropdownToggle>
        <DropdownMenu right class="mt-4 min-w-[250px] p-3.5 pb-0">
          <div>
            Log in with
            <div class="mt-3 mb-1 flex flex-wrap justify-around">
              <Button color="google" href="/api/account/auth/google" rel="external" class="w-[46%] mb-2">Google</Button>
              <Button color="discord" href="/api/account/auth/discord" rel="external" class="w-[46%] mb-2">Discord</Button>
              <Button color="facebook" href="/api/account/auth/facebook" rel="external" class="w-[46%] mb-2">Facebook</Button>
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
          <div class="mt-3 border-t border-gray-200 p-3.5 text-center dark:border-gray-700">
            New ? <a href="/signup"><b>Join us</b></a>
          </div>
        </DropdownMenu>
      </Dropdown>
    {:else}
      {#if admin}
        <NavLink href={adminLink} class="flex items-center gap-2">
          <Icon icon={gearFill} inline={true} class="text-lg" />
          <span class="hidden sm:inline">Admin</span>
        </NavLink>
      {/if}
      <NavLink
        href={`/user/${$user.account.username}`}
        data-sveltekit-preload-data="hover"
        class="flex items-center gap-2 py-0"
      >
        <span class="hidden sm:inline">{$user.account.username}</span>
      </NavLink>
      <NavLink onclick={logOut} class="flex items-center gap-2">
        <Icon icon={power} inline={true} class="text-lg" />
        <span class="hidden sm:inline">Log out</span>
      </NavLink>
    {/if}
  </Nav>
</Navbar>
