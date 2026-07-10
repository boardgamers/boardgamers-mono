<script lang="ts">
	import "../app.css";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import NavBar from "$components/NavBar.svelte";
	import Sidebar from "$components/Sidebar.svelte";
	import Toast from "$components/Toast.svelte";
	import type { Snippet } from "svelte";
	import type { UserFront } from "@bgs/models";

	let { data, children }: { data: import("./+layout.ts").LayoutData; children: Snippet } = $props();

	const isLoginPage = $derived(page.url.pathname === "/login");

	// When there's no user (and we're not on the login page), redirect to login.
	// data.user comes from +layout.ts load; login/logout call invalidateAll() to refetch it.
	$effect(() => {
		if (!data.user && !isLoginPage) {
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

{#if isLoginPage}
	{@render children()}
{:else if data.user}
	<div class="h-full flex flex-col">
		<NavBar user={data.user} />
		<div class="flex flex-1 overflow-hidden">
			<Sidebar {data} />
			<main class="flex-1 overflow-y-auto p-6">
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<Toast />
