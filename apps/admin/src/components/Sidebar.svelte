<script lang="ts" module>
	// Shared across every mounted Sidebar instance. The layout mounts TWO Sidebars
	// (desktop + mobile drawer, the latter only hidden via CSS — never unmounted), and
	// a per-instance `$state` made their URL-sync `$effect`s fight: sidebar A's goto()
	// re-ran sidebar B's effect with B's stale pageLang, B goto'd back, A re-ran, … —
	// an infinite replaceState loop (the pageLang flicker). One shared state means both
	// effects converge on the same value and the urlLang === pageLang guard stops them.
	let pageLang = $state("en");
</script>

<script lang="ts">
	import { goto } from "$app/navigation";
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
	// The language is mirrored to the ?pageLang query param so a refresh (or a
	// shared link) restores it. `|| "en"` also covers a hand-crafted `?pageLang=`.
	// Sync the shared state from the URL on mount (it's module-level, see the
	// module script above for why it can't be a per-instance $state initializer).
	pageLang = page.url.searchParams.get("pageLang") || "en";

	// Keep the URL in sync when the admin switches language (replaceState, not
	// pushState — switching language isn't a navigation worth a history entry).
	// Compare the RESOLVED pageLang (URL param vs state), NOT the raw search
	// string: goto() re-navigates and SvelteKit can normalize the query string
	// (param order/encoding), so a string compare of `url.search` can keep
	// mismatching after the goto and loop forever (param added → goto → removed
	// → goto → …). The value compare is idempotent: once the URL's pageLang
	// equals the state's, no more goto.
	$effect(() => {
		const urlLang = page.url.searchParams.get("pageLang") || "en";
		if (urlLang === pageLang) {
			return;
		}
		const url = new URL(page.url);
		if (pageLang === "en") {
			url.searchParams.delete("pageLang");
		} else {
			url.searchParams.set("pageLang", pageLang);
		}
		goto(url.pathname + url.search + url.hash, { replaceState: true, noScroll: true, keepFocus: true });
	});
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
	// in a language, as a server-side job polled to completion. The job is
	// keyed by LANGUAGE, not tied to the currently selected one: an admin can
	// start a bulk for one language, switch to another, and start a second
	// bulk there — each runs independently and shows its own progress.
	interface BulkRun {
		done: number;
		total: number;
	}
	let bulkRuns = $state<Record<string, BulkRun>>({});
	const currentRun = $derived(bulkRuns[pageLang]);

	async function refreshAll(lang: string) {
		if (bulkRuns[lang]) return;
		bulkRuns[lang] = { done: 0, total: 0 };
		try {
			const jobId = await startBulkTranslate({ targetLang: lang });
			const job = await pollBulkTranslateJob(jobId, (j) => (bulkRuns[lang] = { done: j.done, total: j.total }));
			const summary = `Translated ${job.translated}, skipped ${job.skipped} up-to-date`;
			if (job.errors.length > 0) {
				toast.error(
					`[${lang}] ${summary}, ${job.errors.length} error(s): ${job.errors[0].page} (${job.errors[0].lang})`
				);
			} else {
				toast.success(`[${lang}] ${summary}`);
			}
			await loadPages();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Bulk translation failed");
		} finally {
			delete bulkRuns[lang];
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
		{#if data.me.fullAdmin}
			<a
				href={resolve("/audit-log")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/audit-log')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Audit log
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
		{#if canSee(data.me, "pages")}
			<a
				href={resolve("/translations")}
				class="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 {isActive('/translations')
					? 'bg-gray-100 dark:bg-gray-800 font-semibold'
					: ''}"
			>
				Translations
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
								onclick={() => refreshAll(pageLang)}
								disabled={!!currentRun}
								title="LLM-translate every page that's missing or outdated in {pageLang}"
								class="text-xs rounded border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 hover:bg-violet-50 dark:hover:bg-violet-950 disabled:opacity-50 whitespace-nowrap"
							>
								{currentRun
									? currentRun.total > 0
										? `${currentRun.done}/${currentRun.total} pages…`
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
