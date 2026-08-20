<script lang="ts">
	import "../app.css";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import NavBar from "$components/NavBar.svelte";
	import Sidebar from "$components/Sidebar.svelte";
	import Toast from "$components/Toast.svelte";
	import { on } from "svelte/events";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps = $props();

	const isLoginPage = $derived(page.url.pathname === "/login");

	let sidebarOpen = $state(false);

	// Close the mobile sidebar on navigation
	$effect(() => {
		void page.url.pathname;
		sidebarOpen = false;
	});

	// Close the mobile sidebar on Escape
	$effect(() =>
		on(window, "keydown", (e) => {
			if (e.key === "Escape") sidebarOpen = false;
		})
	);

	// When there's no user (and we're not on the login page), redirect to login.
	// data.user comes from +layout.ts load; login/logout call invalidateAll() to refetch it.
	$effect(() => {
		if (!data.user && !isLoginPage) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is resolve()d; the rule can't trace resolve() + query-string concatenation
			goto(`${resolve("/login")}?redirect=${encodeURIComponent(page.url.pathname)}`);
		}
	});

	// Any admin capability (full admin or at least one scoped grant) lets the
	// user in; the sidebar then shows only what their permissions cover.
	const hasAdminAccess = $derived(data.me.fullAdmin || data.me.permissions.length > 0 || data.me.games.length > 0);

	// Restore dark mode preference
	if (typeof window !== "undefined") {
		const theme = localStorage.getItem("theme");
		if (theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
			document.documentElement.classList.add("dark");
		}
	}
</script>

{#if isLoginPage}
	{@render children()}
{:else if data.user && !hasAdminAccess}
	<div class="h-full flex items-center justify-center">
		<div class="text-center space-y-2">
			<h1 class="text-lg font-semibold">BGS Admin</h1>
			<p class="text-sm text-gray-500">This account has no admin permissions.</p>
		</div>
	</div>
{:else if data.user}
	<div class="h-full flex flex-col">
		<NavBar user={data.user} onMenuClick={() => (sidebarOpen = true)} />
		<div class="relative flex flex-1 overflow-hidden">
			<!-- Desktop: always visible -->
			<div class="hidden md:block h-full shrink-0">
				<Sidebar {data} />
			</div>
			<!-- Mobile: slide-in drawer over the content -->
			{#if sidebarOpen}
				<button
					class="fixed inset-0 z-40 bg-black/50 md:hidden"
					onclick={() => (sidebarOpen = false)}
					aria-label="Close menu"
					tabindex="-1"
				></button>
			{/if}
			<div
				class="fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 md:hidden {sidebarOpen
					? 'translate-x-0'
					: '-translate-x-full'}"
			>
				<Sidebar {data} />
			</div>
			<main class="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<Toast />
