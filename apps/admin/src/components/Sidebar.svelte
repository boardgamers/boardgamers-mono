<script lang="ts">
	import { page } from "$app/state";
	import { data, loadGames, loadPages } from "$lib/stores.svelte.ts";
	import { auth } from "$lib/auth.svelte.ts";

	let gamesOpen = $state(true);
	let pagesOpen = $state(true);

	$effect(() => {
		if (auth.user) {
			loadGames();
			loadPages();
		}
	});

	function isActive(href: string): boolean {
		return page.url.pathname === href;
	}
</script>

<aside class="w-60 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto shrink-0">
	<nav class="p-3 flex flex-col gap-0.5 text-sm">
		<a
			href="/"
			class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/')
				? 'bg-gray-100 dark:bg-gray-800 font-semibold'
				: ''}"
		>
			Dashboard
		</a>
		<a
			href="/users"
			class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/users')
				? 'bg-gray-100 dark:bg-gray-800 font-semibold'
				: ''}"
		>
			Users
		</a>

		<div class="mt-4">
			<button
				onclick={() => (gamesOpen = !gamesOpen)}
				class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400"
			>
				Boardgames
				<svg
					class="w-4 h-4 transition-transform {gamesOpen ? 'rotate-90' : ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg
				>
			</button>
			{#if gamesOpen}
				<div class="flex flex-col gap-0.5">
					<a
						href="/game/new"
						class="px-3 py-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium"
					>
						+ New game
					</a>
					{#each data.games as g}
						{@const href = `/game/${g._id.game}/${g._id.version}`}
						<a
							{href}
							class="px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 truncate {isActive(href)
								? 'bg-gray-100 dark:bg-gray-800 font-semibold'
								: ''}"
							title="{g.label} v{g._id.version}"
						>
							{g.label} <span class="text-gray-400">v{g._id.version}</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<div class="mt-4">
			<button
				onclick={() => (pagesOpen = !pagesOpen)}
				class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400"
			>
				Pages
				<svg
					class="w-4 h-4 transition-transform {pagesOpen ? 'rotate-90' : ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg
				>
			</button>
			{#if pagesOpen}
				<div class="flex flex-col gap-0.5">
					<a
						href="/page/new"
						class="px-3 py-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium"
					>
						+ New page
					</a>
					{#each data.pages as p}
						{@const href = `/page/${p._id.name}/${p._id.lang}`}
						<a
							{href}
							class="px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 truncate {isActive(href)
								? 'bg-gray-100 dark:bg-gray-800 font-semibold'
								: ''}"
						>
							{p._id.name} <span class="text-gray-400">({p._id.lang})</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</nav>
</aside>
