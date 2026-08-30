<script lang="ts">
	import {
		Navbar,
		Nav,
		Dropdown,
		DropdownToggle,
		DropdownMenu,
		DropdownItem,
		Button,
		Input,
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
	import IconGlobe from "@/components/icons/IconGlobe.svelte";
	import { handleError } from "@/utils";
	import { enhance } from "$app/forms";
	import { account, login, logout } from "@/lib/account.svelte";
	import { logoClick, live, activeGames, avatarVersion } from "@/lib/stores.svelte";
	import { browser } from "$app/environment";
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import { currentTheme, cycleTheme, type Theme } from "@/lib/theme";
	import UserAvatar from "../User/UserAvatar.svelte";
	import { page } from "$app/state";
	import type { UserFront } from "@bgs/models";
	import { m, language, switchLanguage } from "@/lib/i18n/messages";
	import { locales, localeNames, type Locale } from "@/lib/i18n/locales";
	import { post } from "@/lib/api";

	const themeLabel = $derived<Record<Theme, string>>({
		light: m.theme_light(),
		dark: m.theme_dark(),
		system: m.theme_system(),
	});

	let { class: className = "", ...rest } = $props();
	let email = $state("");
	let password = $state("");

	// SSR renders the snapshot, the client renders the seeded store (single source of
	// truth once hydrated) — see the "seed once per identity" invariant in stores.svelte.ts.
	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));

	/**
	 * Progressive enhancement (issue #151): both auth forms below are plain HTML form
	 * POSTs (to /login's and /logout's form actions) so they work with JS disabled.
	 * `use:enhance` intercepts the submit for JS users and keeps the fetch-based flow
	 * (no navigation, instant store seed); without JS the server actions relay the
	 * API's session-cookie set/clear to the browser and redirect.
	 */
	const enhanceLogin = ({ cancel }: { cancel: () => void }) => {
		cancel();
		login(email, password).catch(handleError);
	};

	const enhanceLogout = ({ cancel }: { cancel: () => void }) => {
		cancel();
		logout().catch(handleError);
	};

	// No-JS: the appbar login form bounces back here once authenticated (the server
	// action only honours same-origin redirects).
	const loginRedirect = $derived(page.url.pathname + page.url.search);

	// Hugging Face uses CIMD (see api config/passport.ts): the env's own
	// /.well-known/oauth-cimd doc is the client_id and names this origin's callback, so
	// every environment — prod and PR previews alike — logs in directly, no prod relay.
	const socialProviders = [
		{ name: "Google", href: "/auth/google", icon: IconGoogle },
		{ name: "Discord", href: "/auth/discord", icon: IconDiscord },
		// Facebook is being phased out (codeberg boardgamers#99, step 1): the button stays
		// because this row is the LOGIN surface for existing facebook-linked accounts; the
		// api rejects unknown facebook ids with a clear message, so no new signups happen.
		{ name: "Facebook", href: "/auth/facebook", icon: IconFacebook },
		{ name: "GitHub", href: "/auth/github", icon: IconGithub },
		{ name: "Hugging Face", href: "/auth/huggingface", icon: IconHuggingFace },
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
			// The admin panel's vite dev port (apps/admin/vite.config.ts).
			return `${protocol}//${hostname}:5180`;
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
					new Notification("Boardgamers 🌌", { icon: "/favicon-active.ico", body: m.nav_turnNotification() });
				}
			}
		}
	};

	$effect(() => {
		hasGames;
		if (browser) onHasGamesChanged();
	});

	// Language switcher (#306): flip the UI language client-side (cookie stamped by
	// switchLanguage), and persist the preference on the account when logged in so
	// the next session — on any device — resolves it (fire-and-forget; a failure
	// leaves the local switch in place and toasts).
	async function chooseLanguage(locale: Locale) {
		await switchLanguage(locale);
		if (user) {
			post<UserFront>("/account", { settings: { language: locale } })
				.then((updated) => account.set(updated))
				.catch(() => handleError(m.lang_persist_error()));
		}
	}
</script>

<Navbar color="primary" class={className} dark expand>
	<a
		href={resolve("/(app)")}
		onclick={(event) => {
			// On the home page the click is a "refresh game lists" affordance — skip the
			// redundant navigation. Off home it's plain navigation to `/` (a fresh load,
			// so bumping the counter is pointless). The href keeps no-JS/middle-click
			// navigation working.
			if (page.url.pathname === resolve("/(app)")) {
				event.preventDefault();
				logoClick();
			}
		}}
		data-sveltekit-preload-data="hover"
		class="me-1 sm:me-2 text-xl font-bold text-white no-underline hover:text-white">BGS</a
	>

	{#if user}
		<a
			class={`me-1 sm:me-3 flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold text-white no-underline transition hover:text-white ${
				hasGames ? "bg-green-600 hover:bg-green-500" : "bg-gray-500 hover:bg-gray-400"
			}`}
			href={resolve("/(app)/next-game")}
			title={hasGames ? m.nav_activeGamesWaiting({ count: myActiveGames.length }) : m.nav_noActiveGames()}
			id="active-game-count"
		>
			{myActiveGames.length}
		</a>
	{/if}

	<a
		href={resolve("/(app)/boardgames")}
		title={m.nav_boardgamesList()}
		data-sveltekit-preload-data="hover"
		class="shrink-0"
	>
		<img src="/images/icons/dice.svg" height="28" width="28" alt={m.nav_boardgamesList()} />
	</a>

	<audio preload="none" id="sound-notification">
		<source src="/audio/notification.mp3" type="audio/mpeg" />
		<source src="/audio/notification.ogg" type="audio/ogg" />
	</audio>

	<Nav class="ms-auto" navbar>
		<button
			onclick={cycleTheme}
			title={m.theme_title({ theme: themeLabel[$currentTheme] })}
			class="me-1 sm:me-2 flex items-center gap-1 rounded-md px-1 sm:px-2 py-1 text-white hover:bg-white/10"
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

		<!-- Language switcher (#306): cookie + optional account preference, no /de/ URLs. -->
		<Dropdown nav inNavbar>
			<DropdownToggle
				nav
				caret
				title={m.lang_switcher_title({ language: localeNames[$language] })}
				aria-label={m.lang_switcher_label()}
				class="flex items-center gap-1"
			>
				<IconGlobe size="1.25rem" />
				<span class="hidden uppercase sm:inline">{$language}</span>
			</DropdownToggle>
			<DropdownMenu right class="dropdown-menu mt-4 text-gray-900 dark:text-gray-100">
				{#each locales as locale (locale)}
					<DropdownItem
						onclick={() => chooseLanguage(locale)}
						aria-current={locale === $language}
						class="flex items-center justify-between gap-3 {locale === $language ? 'font-semibold' : ''}"
					>
						{localeNames[locale]}
						{#if locale === $language}
							<span aria-hidden="true">✓</span>
						{/if}
					</DropdownItem>
				{/each}
			</DropdownMenu>
		</Dropdown>

		{#if !user}
			<span class="hidden text-white sm:inline">{m.nav_haveAccount()}</span>
			<Dropdown nav inNavbar>
				<DropdownToggle nav caret>{m.nav_login()}</DropdownToggle>
				<!-- No-JS (#151): dropdowns need JS — render a plain link to the login page. -->
				<noscript>
					<a href={resolve("/(app)/login")} class="px-3 py-2 rounded-md text-white no-underline">{m.nav_loginPage()}</a>
				</noscript>
				<!-- text-gray-900: the navbar paints its text white, reset it so the menu is readable in light mode -->
				<DropdownMenu right class="dropdown-menu mt-4 min-w-[250px] p-3.5 pb-0 text-gray-900 dark:text-gray-100">
					<div>
						{m.nav_logInWith()}
						<div class="mt-3 mb-1 flex justify-around">
							<!-- OAuth endpoints, not app routes: off-site navigation (rel="external"). -->
							{#each socialProviders as provider (provider.name)}
								<a
									href={provider.href}
									rel="external"
									title={m.nav_continueWith({ provider: provider.name })}
									aria-label={m.nav_continueWith({ provider: provider.name })}
									class="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-800 no-underline transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
								>
									<provider.icon size="1.25rem" />
								</a>
							{/each}
						</div>
						{m.nav_or()}
						<form class="mt-3" method="POST" action={resolve("/(app)/login")} use:enhance={enhanceLogin}>
							<input type="hidden" name="redirect" value={loginRedirect} />
							<FormGroup>
								<Label hidden for="email">{m.nav_emailOrUsername()}</Label>
								<Input
									id="email"
									type="text"
									name="email"
									placeholder={m.nav_emailOrUsernamePlaceholder()}
									required
									bind:value={email}
									autofocus
								/>
							</FormGroup>
							<FormGroup>
								<Label hidden for="password">{m.common_password()}</Label>
								<Input
									id="password"
									type="password"
									name="password"
									placeholder={m.common_password()}
									bind:value={password}
									required
								/>
								<FormText class="mt-2 pt-2">
									<a href={resolve("/(app)/forgotten-password")}>{m.nav_forgottenPassword()}</a>
								</FormText>
							</FormGroup>
							<FormGroup>
								<Button type="submit" color="primary" block>{m.common_logIn()}</Button>
							</FormGroup>
						</form>
					</div>
					<div class="mt-3 border-t border-gray-200 p-3.5 text-center dark:border-gray-700">
						{m.nav_newJoinUs()} <a href={resolve("/(app)/signup")}><b>{m.nav_joinUs()}</b></a>
					</div>
				</DropdownMenu>
			</Dropdown>
		{:else}
			{#if admin}
				<NavLink href={adminLink} rel="external" class="flex items-center gap-2 !px-2 sm:!px-3">
					<IconGearFill size="1.25rem" />
					<span class="hidden sm:inline">{m.nav_admin()}</span>
				</NavLink>
			{/if}
			<NavLink
				href={resolve("/(app)/user/[username]", { username: user.account.username })}
				data-sveltekit-preload-data="hover"
				class="flex shrink-0 items-center gap-2 rounded-md px-1 sm:px-2 py-1 no-underline hover:bg-white/10 hover:text-white"
			>
				<UserAvatar username={user.account.username} userId={user._id} size="1.75rem" v={$avatarVersion} />
				<span class="hidden sm:inline">{user.account.username}</span>
			</NavLink>
			<!-- Plain form POST so logout works without JS (#151); JS intercepts via use:enhance. -->
			<form method="POST" action={resolve("/(app)/logout")} use:enhance={enhanceLogout} class="flex">
				<button
					type="submit"
					title={m.nav_logOutTitle()}
					class="flex items-center gap-2 rounded-md px-1 sm:px-2 py-1 text-white hover:bg-white/10 hover:text-white"
				>
					<IconPower size="1.25rem" />
					<span class="hidden sm:inline">{m.nav_logout()}</span>
				</button>
			</form>
		{/if}
	</Nav>
</Navbar>
