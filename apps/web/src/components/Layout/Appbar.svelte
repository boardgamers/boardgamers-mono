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
	import IconGithub from "@/components/icons/IconGithub.svelte";
	import IconGoogle from "@/components/icons/IconGoogle.svelte";
	import IconDiscord from "@/components/icons/IconDiscord.svelte";
	import IconFacebook from "@/components/icons/IconFacebook.svelte";
	import IconHuggingFace from "@/components/icons/IconHuggingFace.svelte";
	import IconSunFill from "@/components/icons/IconSunFill.svelte";
	import IconMoonFill from "@/components/icons/IconMoonFill.svelte";
	import IconCircleHalf from "@/components/icons/IconCircleHalf.svelte";
	import { handleError } from "@/utils";
	import { account, login, logout } from "@/lib/account.svelte";
	import { logoClick, live, activeGames, avatarVersion } from "@/lib/stores.svelte";
	import { browser } from "$app/environment";
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
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

	// SSR renders the snapshot, the client renders the seeded store (single source of
	// truth once hydrated) — see the "seed once per identity" invariant in stores.svelte.ts.
	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));

	const handleSubmit = (event: Event) => {
		event.preventDefault();

		login(email, password).catch(handleError);
	};

	const logOut = () => {
		logout().catch(handleError);
	};

	// Hugging Face uses CIMD (see api config/passport.ts): the env's own
	// /.well-known/oauth-cimd doc is the client_id and names this origin's callback, so
	// every environment — prod and PR previews alike — logs in directly, no prod relay.
	const socialProviders = [
		{ name: "Google", href: "/api/account/auth/google", icon: IconGoogle },
		{ name: "Discord", href: "/api/account/auth/discord", icon: IconDiscord },
		{ name: "Facebook", href: "/api/account/auth/facebook", icon: IconFacebook },
		{ name: "GitHub", href: "/api/account/auth/github", icon: IconGithub },
		{ name: "Hugging Face", href: "/api/account/auth/huggingface", icon: IconHuggingFace },
	];

	let admin = $derived(user?.authority === "admin");
	// SSR renders the snapshot; the client trusts the websocket-fed store, so an empty
	// store after a `games:currentTurn` push correctly shows "no games" (the #167 fix).
	let myActiveGames = $derived(live($activeGames, (page.data.activeGames as string[]) ?? []));

	// Derive the admin panel URL from the current host: local dev → local admin port,
	// production → admin.<root-domain>, PR preview → admin-pr-<n>.<root-domain>.
	// The preview admin uses a dash-subdomain, not admin.pr-<n>..., because the
	// *.boardgamers.space cert only covers one subdomain level. External link.
	let adminLink = $derived.by((): `http${string}` => {
		const { hostname } = page.url;
		const protocol = page.url.protocol as "http:" | "https:";
		if (hostname === "localhost" || hostname === "127.0.0.1") {
			return `${protocol}//${hostname}:8613`;
		}
		const prPreview = /^pr-(\d+)\.(.+)$/.exec(hostname);
		if (prPreview) {
			return `${protocol}//admin-pr-${prPreview[1]}.${prPreview[2]}`;
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
		href={resolve("/(app)")}
		onclick={logoClick}
		data-sveltekit-preload-data="hover"
		class="me-2 text-xl font-bold text-white no-underline hover:text-white">BGS</a
	>

	{#if user}
		<a
			class={`me-3 flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold text-white no-underline transition hover:text-white ${
				hasGames ? "bg-green-600 hover:bg-green-500" : "bg-gray-500 hover:bg-gray-400"
			}`}
			href={resolve("/(app)/next-game")}
			title={hasGames
				? `${myActiveGames.length} ${myActiveGames.length === 1 ? "game" : "games"} waiting for your move — click to jump to the next one`
				: "No games waiting for your move"}
			id="active-game-count"
		>
			{myActiveGames.length}
		</a>
	{/if}

	<a href={resolve("/(app)/boardgames")} title="Boardgames list" data-sveltekit-preload-data="hover">
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
			<span class="hidden text-white sm:inline">Have an account?</span>
			<Dropdown nav inNavbar>
				<DropdownToggle nav caret>Login</DropdownToggle>
				<!-- text-gray-900: the navbar paints its text white, reset it so the menu is readable in light mode -->
				<DropdownMenu right class="dropdown-menu mt-4 min-w-[250px] p-3.5 pb-0 text-gray-900 dark:text-gray-100">
					<div>
						Log in with
						<div class="mt-3 mb-1 flex justify-around">
							<!-- OAuth endpoints, not app routes: off-site navigation (rel="external"). -->
							{#each socialProviders as provider (provider.name)}
								<a
									href={provider.href}
									rel="external"
									title="Continue with {provider.name}"
									aria-label="Continue with {provider.name}"
									class="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-800 no-underline transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
								>
									<provider.icon size="1.25rem" />
								</a>
							{/each}
						</div>
						or
						<Form class="mt-3" onsubmit={handleSubmit}>
							<FormGroup>
								<Label hidden for="email">Email or username</Label>
								<Input
									id="email"
									type="text"
									name="email"
									placeholder="Email address or username"
									required
									bind:value={email}
									autofocus
								/>
							</FormGroup>
							<FormGroup>
								<Label hidden for="password">Password</Label>
								<Input
									id="password"
									type="password"
									name="password"
									placeholder="Password"
									bind:value={password}
									required
								/>
								<FormText class="mt-2 pt-2">
									<a href={resolve("/(app)/forgotten-password")}>Forgotten password ?</a>
								</FormText>
							</FormGroup>
							<FormGroup>
								<Button type="submit" color="primary" block>Log in</Button>
							</FormGroup>
						</Form>
					</div>
					<div class="mt-3 border-t border-gray-200 p-3.5 text-center dark:border-gray-700">
						New ? <a href={resolve("/(app)/signup")}><b>Join us</b></a>
					</div>
				</DropdownMenu>
			</Dropdown>
		{:else}
			{#if admin}
				<NavLink href={adminLink} rel="external" class="flex items-center gap-2">
					<IconGearFill size="1.25rem" />
					<span class="hidden sm:inline">Admin</span>
				</NavLink>
			{/if}
			<NavLink
				href={resolve("/(app)/user/[username]", { username: user.account.username })}
				data-sveltekit-preload-data="hover"
				class="flex items-center gap-2 rounded-md px-2 py-1 no-underline hover:bg-white/10 hover:text-white"
			>
				<UserAvatar username={user.account.username} userId={user._id} size="1.75rem" v={$avatarVersion} />
				<span class="hidden sm:inline">{user.account.username}</span>
			</NavLink>
			<NavLink
				onclick={logOut}
				title="Log out"
				class="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/10 hover:text-white"
			>
				<IconPower size="1.25rem" />
				<span class="hidden sm:inline">Log out</span>
			</NavLink>
		{/if}
	</Nav>
</Navbar>
