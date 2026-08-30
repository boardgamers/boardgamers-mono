<script lang="ts">
	import { browser } from "$app/environment";
	import { tick } from "svelte";
	import { m } from "@/lib/i18n/messages";
	import { EMOJI_CATEGORIES } from "./chat-emoji-data";

	let { onpick, onclose }: { onpick: (emoji: string) => void; onclose: () => void } = $props();

	const RECENT_KEY = "chat-emoji-recent";
	const RECENT_MAX = 16;
	const GRID_COLUMNS = 8;

	// Section headers / jump-row labels ride the message catalogs; the emoji
	// names/keywords themselves are deliberately English-only (see chat-emoji-data).
	const labels: Record<string, () => string> = {
		recent: () => m.chat_emoji_recent(),
		smileys: () => m.chat_emoji_smileys(),
		people: () => m.chat_emoji_people(),
		nature: () => m.chat_emoji_nature(),
		food: () => m.chat_emoji_food(),
		activities: () => m.chat_emoji_activities(),
		objects: () => m.chat_emoji_objects(),
		symbols: () => m.chat_emoji_symbols(),
	};

	function loadRecent(): string[] {
		if (!browser) {
			return [];
		}
		try {
			const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
			// Dedup defensively: duplicate keys in the keyed {#each} are a Svelte
			// runtime error, so tampered/legacy storage would brick the picker.
			return Array.isArray(parsed)
				? [...new Set(parsed.filter((e) => typeof e === "string"))].slice(0, RECENT_MAX)
				: [];
		} catch {
			return [];
		}
	}

	// Display snapshot taken at mount: re-sorting the recents section under the
	// pointer on every pick would shift the grid mid-click-spree. Storage still
	// updates on every pick; the next open shows the fresh order.
	const initialRecent = loadRecent();
	let storedRecent = initialRecent;

	type Section = { id: string; icon: string; label: () => string; emoji: string[] };
	const sections: Section[] = [
		...(initialRecent.length > 0
			? [{ id: "recent", icon: "🕒", label: labels.recent, emoji: initialRecent } satisfies Section]
			: []),
		...EMOJI_CATEGORIES.map((c) => ({
			id: c.id,
			icon: c.icon,
			label: labels[c.id] ?? (() => c.id),
			emoji: c.emoji.map(([emoji]) => emoji),
		})),
	];

	let query = $state("");
	let normalized = $derived(query.trim().toLowerCase());
	// English keyword search (Discord does the same); pasting an emoji finds it too.
	let results = $derived(
		normalized
			? EMOJI_CATEGORIES.flatMap((c) =>
					c.emoji
						.filter(([emoji, keywords]) => emoji === query.trim() || keywords.includes(normalized))
						.map(([emoji]) => emoji)
				)
			: []
	);
	// One list either way: searching swaps the category sections for a single
	// results section, diffed as a keyed each (a plain {#if}/{:else} swap here
	// trips branch teardown in the cross-realm jsdom test env).
	let displaySections = $derived(
		normalized
			? [{ id: "search", icon: "🔎", label: () => m.chat_emoji_searchResults(), emoji: results } satisfies Section]
			: sections
	);

	let active = $state(sections[0].id);
	let searchEl = $state<HTMLInputElement>();
	let listEl = $state<HTMLDivElement>();

	function pick(emoji: string) {
		storedRecent = [emoji, ...storedRecent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
		if (browser) {
			try {
				localStorage.setItem(RECENT_KEY, JSON.stringify(storedRecent));
			} catch {
				// Quota/private-mode failures just lose the "recent" convenience.
			}
		}
		onpick(emoji);
	}

	async function jumpTo(id: string) {
		active = id;
		if (normalized) {
			query = "";
			await tick(); // the sections replace the search results before we can scroll to one
		}
		const section = listEl?.querySelector<HTMLElement>(`[data-section="${id}"]`);
		if (section && listEl) {
			listEl.scrollTop = section.offsetTop;
		}
	}

	// Scroll spy: highlight the jump button of the topmost visible section —
	// except at the very bottom, where the last section wins (it may be too
	// short to ever reach the top, e.g. right after jumping to it).
	function onListScroll() {
		if (!listEl || normalized) {
			return;
		}
		if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 2) {
			active = sections[sections.length - 1].id;
			return;
		}
		const top = listEl.scrollTop + 8;
		let current = sections[0].id;
		for (const el of listEl.querySelectorAll<HTMLElement>("[data-section]")) {
			if (el.offsetTop <= top) {
				current = el.dataset.section ?? current;
			}
		}
		active = current;
	}

	// Roving arrow-key navigation across the emoji grids; Tab still moves
	// between search / jump row / list / rest of the form as usual.
	function onGridKeydown(e: KeyboardEvent) {
		const moves: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -GRID_COLUMNS,
			ArrowDown: GRID_COLUMNS,
		};
		if (!(e.key in moves) && e.key !== "Home" && e.key !== "End") {
			return;
		}
		const buttons = [...(listEl?.querySelectorAll<HTMLButtonElement>('button[role="option"]') ?? [])];
		if (buttons.length === 0) {
			return;
		}
		const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
		let next: number;
		if (e.key === "Home") {
			next = 0;
		} else if (e.key === "End") {
			next = buttons.length - 1;
		} else {
			next = current === -1 ? 0 : current + moves[e.key];
		}
		if (next < 0) {
			// ArrowUp from the first row hands focus back to the search input.
			if (e.key === "ArrowUp") {
				e.preventDefault();
				searchEl?.focus();
			}
			return;
		}
		if (next >= buttons.length) {
			return;
		}
		e.preventDefault();
		buttons[next].focus();
	}

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			// The picker lives inside the chat <form> — Enter must pick the first
			// result, not send the message.
			e.preventDefault();
			e.stopPropagation();
			if (results.length > 0) {
				pick(results[0]);
			}
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			listEl?.querySelector("button")?.focus();
		}
	}

	// The chat Modal closes itself on Escape (document listener + backdrop
	// keydown) — swallow the event here so Esc only closes the picker.
	function onRootKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.stopPropagation();
			e.preventDefault();
			onclose();
		}
	}

	// Focus the search on open, Discord-style — the caller restores focus to
	// the chat input on close.
	$effect(() => {
		searchEl?.focus();
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (keydown is Escape-only plumbing, the controls inside are the interactive parts) -->
<div
	class="rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-600 dark:bg-gray-800"
	role="dialog"
	aria-label={m.chat_emoji_picker()}
	tabindex="-1"
	onkeydown={onRootKeydown}
	data-testid="emoji-picker"
>
	<input
		bind:this={searchEl}
		bind:value={query}
		type="search"
		placeholder={m.chat_emoji_search()}
		aria-label={m.chat_emoji_search()}
		onkeydown={onSearchKeydown}
		class="mb-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
	/>
	<div class="mb-1 flex gap-1 border-b border-gray-200 pb-1 dark:border-gray-700" role="tablist">
		{#each sections as section (section.id)}
			<button
				type="button"
				role="tab"
				aria-selected={active === section.id}
				aria-label={section.label()}
				title={section.label()}
				class="flex-1 rounded-md py-1 text-base leading-none hover:bg-gray-100 dark:hover:bg-gray-700 {active ===
				section.id
					? 'bg-gray-200 dark:bg-gray-600'
					: ''}"
				onclick={() => jumpTo(section.id)}
			>
				{section.icon}
			</button>
		{/each}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions (arrow-key roving focus for the option buttons inside) -->
	<div
		class="thin-scrollbar relative max-h-64 overflow-y-auto"
		bind:this={listEl}
		onscroll={onListScroll}
		onkeydown={onGridKeydown}
	>
		{#each displaySections as section (section.id)}
			<div data-section={section.id}>
				<div
					class="sticky top-0 z-10 bg-white px-1 py-1 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
				>
					{section.label()}
				</div>
				{#if section.emoji.length === 0}
					<div class="px-1 py-4 text-center text-xs text-gray-500 dark:text-gray-400">{m.chat_emoji_noResults()}</div>
				{/if}
				<div class="grid grid-cols-8 gap-0.5" role="listbox" aria-label={section.label()}>
					{#each section.emoji as emoji (emoji)}
						<button
							type="button"
							role="option"
							aria-selected="false"
							aria-label={emoji}
							class="rounded-md p-1 text-xl leading-none hover:bg-gray-100 dark:hover:bg-gray-700"
							onclick={() => pick(emoji)}
						>
							{emoji}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
