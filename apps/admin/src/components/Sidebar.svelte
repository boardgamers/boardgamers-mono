<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { can, canSee, type AdminMe } from "$lib/permissions.ts";
	import { gameLabelParts } from "$lib/utils.ts";
	import type { PageFront } from "@bgs/models";
	import type { BoardgameEntry } from "../routes/+layout.ts";

	let { data }: { data: { games: BoardgameEntry[]; pages: PageFront[]; me: AdminMe } } = $props();

	let gamesOpen = $state(true);
	let pagesOpen = $state(true);

	// data.games is already one entry per boardgame (the API dedupes versions).
	const boardgames = $derived(data.games);

	function isActive(href: string): boolean {
		return page.url.pathname === href;
	}
</script>

<aside
	class="w-60 h-full border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto shrink-0"
>
	<nav class="p-3 flex flex-col gap-0.5 text-sm">
		{#if can(data.me, "serverinfo")}
			<a
				href={resolve("/")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Dashboard
			</a>
		{/if}
		{#if can(data.me, "users")}
			<a
				href={resolve("/users")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/users')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Users
			</a>
			<a
				href={resolve("/users/deleted")}
				class="pl-6 pr-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 {isActive(
					'/users/deleted'
				)
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Deleted users
			</a>
		{/if}
		{#if can(data.me, "games")}
			<a
				href={resolve("/games")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/games')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Games
			</a>
			<a
				href={resolve("/game/hangs")}
				class="pl-6 pr-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 {isActive(
					'/game/hangs'
				)
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Hangs / timeouts
			</a>
		{/if}
		{#if can(data.me, "loki") || can(data.me, "serverinfo")}
			<a
				href={resolve("/health")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/health')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Server Health
			</a>
		{/if}
		{#if can(data.me, "tokens")}
			<a
				href={resolve("/tokens")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/tokens')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Admin Tokens
			</a>
		{/if}
		{#if can(data.me, "changelog")}
			<a
				href={resolve("/changelog")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/changelog')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Changelog
			</a>
		{/if}
		{#if canSee(data.me, "feedback")}
			<a
				href={resolve("/feedback")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/feedback')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Feedback
			</a>
			<a
				href={resolve("/game-requests")}
				class="pl-6 pr-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 {isActive(
					'/game-requests'
				)
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Game requests
			</a>
		{/if}
		{#if can(data.me, "newsletter")}
			<a
				href={resolve("/newsletter")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/newsletter')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Newsletter
			</a>
		{/if}

		{#if data.games.length > 0 || can(data.me, "gameinfo")}
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
							href={resolve("/game/new")}
							class="px-3 py-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium"
						>
							+ New game
						</a>
						{#each boardgames as g (g._id)}
							{@const href = resolve("/boardgame/[game]", { game: g._id })}
							{@const { emoji, name } = gameLabelParts(g.label)}
							<a
								{href}
								class="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive(
									href
								)
									? 'bg-gray-100 dark:bg-gray-800 font-semibold'
									: ''}"
								title={g._id}
							>
								{#if emoji}<span class="flex-shrink-0">{emoji}</span>{/if}
								<span class="truncate flex-1">{name || g._id}</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if canSee(data.me, "pages")}
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
							href={resolve("/page/new")}
							class="px-3 py-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium"
						>
							+ New page
						</a>
						{#each data.pages as p (`${p._id.name}/${p._id.lang}`)}
							{@const href = resolve("/page/[name]/[lang]", { name: p._id.name, lang: p._id.lang })}
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
		{/if}
	</nav>
</aside>
