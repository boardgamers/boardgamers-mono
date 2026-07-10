<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { clearTokens } from "$lib/auth.svelte.ts";
	import type { UserFront } from "@bgs/models";

	let { user }: { user: UserFront & { _id: string } } = $props();

	function toggleDark() {
		document.documentElement.classList.toggle("dark");
		localStorage.setItem("theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
	}

	async function handleLogout() {
		clearTokens();
		await invalidateAll();
		goto("/login");
	}
</script>

<header
	class="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center px-4 gap-4 shrink-0"
>
	<h1 class="text-lg font-semibold tracking-tight">BGS Admin</h1>
	<div class="flex-1"></div>

	<span class="text-sm text-gray-500 dark:text-gray-400">{user.account.username}</span>
	<button onclick={handleLogout} class="text-sm text-red-600 hover:text-red-500 font-medium">Log out</button>

	<button
		onclick={toggleDark}
		class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
		title="Toggle dark mode"
	>
		<svg class="w-5 h-5 block dark:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
		</svg>
		<svg class="w-5 h-5 hidden dark:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<circle cx="12" cy="12" r="5" /><path
				d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
			/>
		</svg>
	</button>
</header>
