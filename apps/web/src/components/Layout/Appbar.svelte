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
  } from "@/modules/cdk";
  import IconGearFill from "@/components/icons/IconGearFill.svelte";
  import IconPower from "@/components/icons/IconPower.svelte";
  import IconSunFill from "@/components/icons/IconSunFill.svelte";
  import IconMoonFill from "@/components/icons/IconMoonFill.svelte";
  import IconCircleHalf from "@/components/icons/IconCircleHalf.svelte";
  import { handleError } from "@/utils";
  import { account, login, logout } from "@/lib/account.svelte";
  import { logoClick } from "@/lib/stores.svelte";
  import { activeGames } from "@/lib/stores.svelte";
  import { browser } from "$app/environment";
  import { currentTheme, cycleTheme, type Theme } from "@/lib/theme";
  import UserAvatar from "../User/UserAvatar.svelte";
  import { page } from "$app/state";
  import type { UserFront } from "@bgs/models";

  const themeLabel: Record<Theme, string> = {
    light: "Light",
    dark: "Dark",
    system: "System",
  };

  let { class: className = "", ...rest } = $props();
  let email = $state("");
  let password = $state("");

  // Client prefers the account store (seeded by the layout, live-updates on
  // login/logout); SSR falls back to page.data.user so the navbar renders the
  // user immediately without a post-SSR flicker.
  let user = $derived(($account ?? page.data.user) as UserFront | null);

  const handleSubmit = (event: Event) => {
    event.preventDefault();

    login(email, password).catch(handleError);
  };

  const logOut = () => {
    logout().catch(handleError);
  };

  let admin = $derived(user?.authority === "admin");
  // SSR fallback for active games so the count badge doesn't flicker after hydration.
  let myActiveGames = $derived($activeGames.length > 0 ? $activeGames : ((page.data.activeGames as string[]) ?? []));

  // Derive the admin panel URL from the current host: local dev → local admin port,
  // production → admin.<root-domain> (handles www. and subdomains).
  let adminLink = $derived.by(() => {
    const { protocol, hostname } = page.url;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:8613`;
    }
    const rootDomain = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    return `${protocol}//admin.${rootDomain}`;
  });

  let hasGames = $derived(myActiveGames.length > 0);

  const onHasGamesChanged = () => {
    if (hasGames) {
      if (document.hidden) {
        if (user?.settings?.game?.soundNotification) {
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

  {#if user}
    <a
      class={`me-3 rounded-full px-2 py-0.5 text-sm font-semibold text-white ${
        hasGames ? "bg-green-600" : "bg-gray-500"
      }`}
      href="/next-game"
      title={hasGames
        ? `${myActiveGames.length} ${myActiveGames.length === 1 ? "game" : "games"} waiting for your move — click to jump to the next one`
        : "No games waiting for your move"}
      id="active-game-count"
    >
      {myActiveGames.length}
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
      {#if $currentTheme === "light"}
        <IconSunFill size="1.25rem" />
      {:else if $currentTheme === "dark"}
        <IconMoonFill size="1.25rem" />
      {:else}
        <IconCircleHalf size="1.25rem" />
      {/if}
      <span class="hidden sm:inline">{themeLabel[$currentTheme]}</span>
    </button>

    {#if !user}
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
          <IconGearFill size="1.25rem" />
          <span class="hidden sm:inline">Admin</span>
        </NavLink>
      {/if}
      <NavLink
        href={`/user/${user.account.username}`}
        data-sveltekit-preload-data="hover"
        class="flex items-center gap-2 py-0"
      >
        <UserAvatar username={user.account.username} userId={user._id} size="2rem" />
        <span class="hidden sm:inline">{user.account.username}</span>
      </NavLink>
      <NavLink onclick={logOut} class="flex items gap-2">
        <IconPower size="1.25rem" />
        <span class="hidden sm:inline">Log out</span>
      </NavLink>
    {/if}
  </Nav>
</Navbar>
