<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { pollBulkTranslateJob, startBulkTranslate } from "$lib/api.ts";
	import { can, canSee, type AdminMe } from "$lib/permissions.ts";
	import { loadPages } from "$lib/stores.svelte.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { gameLabelParts } from "$lib/utils.ts";
	import { locales } from "@bgs/models/locale";
	import type { PageFront } from "@bgs/models";
	import type { BoardgameEntry } from "../routes/+layout.ts";

	let { data }: { data: { games: BoardgameEntry[]; pages: PageFront[]; me: AdminMe } } = $props();

	let gamesOpen = $state(true);
	let pagesOpen = $state(true);

	// data.games is already one entry per boardgame (the API dedupes versions).
	const boardgames = $derived(data.games);

	// Pages section (#306): one entry per page NAME in the selected language
	// (default "en"). Pages missing in the selected language still show, dimmed
	// and marked "(missing)", so an admin can create the translation.
	let pageLang = $state("en");
	// Offer every supported UI locale, plus any extra language a page already
	// exists in (CMS page languages are unconstrained).
	const pageLangs = $derived.by(() => {
		const langs: Record<string, true> = Object.fromEntries(locales.map((l) => [l, true]));
		for (const p of data.pages) {
			langs[p._id.lang] = true;
		}
		return Object.keys(langs).sort();
	});
	interface PageEntry {
		name: string;
		lang: string;
		missing: boolean;
		outdated: boolean;
	}
	const pageEntries = $derived.by(() => {
		const names = [...new Set(data.pages.map((p) => p._id.name))].sort();
		const byKey = new Map(data.pages.map((p) => [`${p._id.name}/${p._id.lang}`, p]));
		return names.map((name): PageEntry => {
			const page = byKey.get(`${name}/${pageLang}`);
			// Outdated (#306): LLM-translated from a source that has been updated
			// since the translation was made.
			const source = page?.translatedFrom && byKey.get(`${name}/${page.translatedFrom.lang}`);
			const outdated = !!(
				page?.translatedFrom &&
				source?.updatedAt &&
				new Date(source.updatedAt).getTime() > new Date(page.translatedFrom.updatedAt).getTime()
			);
			return { name, lang: pageLang, missing: !page, outdated };
		});
	});

	function isActive(href: string): boolean {
		return page.url.pathname === href;
	}

	// Bulk refresh (#306): LLM-translate every page that's missing or outdated
	// in the selected language, as a server-side job polled to completion.
	let refreshing = $state(false);
	let refreshProgress = $state<{ done: number; total: number } | null>(null);

	async function refreshAll() {
		if (refreshing) return;
		refreshing = true;
		refreshProgress = null;
		try {
			const jobId = await startBulkTranslate({ targetLang: pageLang });
			const job = await pollBulkTranslateJob(jobId, (j) => (refreshProgress = { done: j.done, total: j.total }));
			const summary = `Translated ${job.translated}, skipped ${job.skipped} up-to-date`;
			if (job.errors.length > 0) {
				toast.error(`${summary}, ${job.errors.length} error(s): ${job.errors[0].page} (${job.errors[0].lang})`);
			} else {
				toast.success(summary);
			}
			await loadPages();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Bulk translation failed");
		} finally {
			refreshing = false;
			refreshProgress = null;
		}
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
						<div class="flex items-center gap-2 px-3 py-1">
							<label for="pages-lang" class="text-xs text-gray-400">Language</label>
							<select
								id="pages-lang"
								bind:value={pageLang}
								class="ml-auto text-xs rounded border border-gray-300 dark:border-gray-700 bg-transparent px-1.5 py-0.5"
							>
								{#each pageLangs as lang (lang)}
									<option value={lang}>{lang}</option>
								{/each}
							</select>
							<button
								onclick={refreshAll}
								disabled={refreshing}
								title="LLM-translate every page that's missing or outdated in {pageLang}"
								class="text-xs rounded border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 hover:bg-violet-50 dark:hover:bg-violet-950 disabled:opacity-50 whitespace-nowrap"
							>
								{refreshing
									? refreshProgress
										? `${refreshProgress.done}/${refreshProgress.total}…`
										: "Starting…"
									: "Refresh all"}
							</button>
						</div>
						<a
							href={resolve("/page/new")}
							class="px-3 py-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium"
						>
							+ New page
						</a>
						{#each pageEntries as p (`${p.name}/${p.lang}`)}
							{@const href = resolve("/page/[name]/[lang]", { name: p.name, lang: p.lang })}
							<a
								{href}
								class="px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 truncate {p.missing
									? 'text-gray-400 dark:text-gray-500 italic'
									: ''} {isActive(href) ? 'bg-gray-100 dark:bg-gray-800 font-semibold' : ''}"
								title={p.missing
									? `No ${p.lang} version yet — opens the editor to create it`
									: p.outdated
										? `The source this ${p.lang} version was translated from has been updated since`
										: p.name}
							>
								{p.name}
								{#if p.missing}<span class="text-xs not-italic">(missing)</span>{/if}
								{#if !p.missing && p.outdated}
									<span class="text-xs text-amber-500 dark:text-amber-400">(outdated)</span>
								{/if}
							</a>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</nav>
</aside>
