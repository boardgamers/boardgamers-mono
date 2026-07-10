<script lang="ts">
	import "../app.css";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { auth } from "$lib/auth.svelte.ts";
	import { api } from "$lib/api.ts";
	import NavBar from "$components/NavBar.svelte";
	import Sidebar from "$components/Sidebar.svelte";
	import Toast from "$components/Toast.svelte";
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();

	let loading = $state(true);
	const isLoginPage = $derived(page.url.pathname === "/login");

	onMount(() => {
		checkAuth();
	});

	async function checkAuth() {
		if (auth.refreshToken && !auth.user) {
			try {
				// GET /account returns the user document directly (see apps/web).
				const user = await api.get<NonNullable<(typeof auth)["user"]>>("/account");
				if (user?._id) {
					auth.user = user;
				}
			} catch {
				// not logged in
			}
		}
		loading = false;
	}

	$effect(() => {
		if (!loading && !auth.user && !isLoginPage) {
			goto(`/login?redirect=${encodeURIComponent(page.url.pathname)}`);
		}
	});

	// Restore dark mode preference
	if (typeof window !== "undefined") {
		const theme = localStorage.getItem("theme");
		if (theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
			document.documentElement.classList.add("dark");
		}
	}
</script>

{#if loading}
	<div class="h-full flex items-center justify-center">
		<div
			class="w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-blue-600 rounded-full animate-spin"
		></div>
	</div>
{:else if isLoginPage}
	{@render children()}
{:else if auth.user}
	<div class="h-full flex flex-col">
		<NavBar />
		<div class="flex flex-1 overflow-hidden">
			<Sidebar />
			<main class="flex-1 overflow-y-auto p-6">
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<Toast />
