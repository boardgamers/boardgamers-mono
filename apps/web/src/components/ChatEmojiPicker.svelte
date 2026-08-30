<script lang="ts">
	import { browser } from "$app/environment";
	import { m } from "@/lib/i18n/messages";

	let { onpick, onclose }: { onpick: (emoji: string) => void; onclose: () => void } = $props();

	const RECENT_KEY = "chat-emoji-recent";
	const RECENT_MAX = 16;
	const GRID_COLUMNS = 8;

	function loadRecent(): string[] {
		if (!browser) {
			return [];
		}
		try {
			const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
			return Array.isArray(parsed) ? parsed.filter((e) => typeof e === "string").slice(0, RECENT_MAX) : [];
		} catch {
			return [];
		}
	}

	const initialRecent = loadRecent();
	let recent = $state(initialRecent);

	// Curated set (native emoji rendering): enough for chat banter without
	// shipping the full unicode database. See the PR for the build-or-buy call.
	const categories: { id: string; icon: string; label: () => string; emoji: string[] }[] = [
		{
			id: "recent",
			icon: "🕒",
			label: () => m.chat_emoji_recent(),
			get emoji() {
				return recent;
			},
		},
		{
			id: "smileys",
			icon: "😀",
			label: () => m.chat_emoji_smileys(),
			emoji: [
				"😀",
				"😃",
				"😄",
				"😁",
				"😆",
				"😅",
				"😂",
				"🤣",
				"🙂",
				"😉",
				"😊",
				"😇",
				"🥰",
				"😍",
				"😘",
				"😜",
				"🤪",
				"🤔",
				"🤨",
				"😐",
				"😏",
				"🙄",
				"😬",
				"😴",
				"🤯",
				"😳",
				"🥺",
				"😢",
				"😭",
				"😡",
				"😱",
				"🥳",
			],
		},
		{
			id: "people",
			icon: "👍",
			label: () => m.chat_emoji_people(),
			emoji: [
				"👍",
				"👎",
				"👏",
				"🙌",
				"🤝",
				"🙏",
				"💪",
				"🤞",
				"✌️",
				"🤘",
				"👌",
				"🤌",
				"👋",
				"✋",
				"👆",
				"👇",
				"👈",
				"👉",
				"🫡",
				"🤷",
				"🤦",
				"🧠",
				"👀",
				"💅",
			],
		},
		{
			id: "nature",
			icon: "🐶",
			label: () => m.chat_emoji_nature(),
			emoji: [
				"🐶",
				"🐱",
				"🐭",
				"🐹",
				"🐰",
				"🦊",
				"🐻",
				"🐼",
				"🐨",
				"🐯",
				"🦁",
				"🐮",
				"🐷",
				"🐸",
				"🐵",
				"🐔",
				"🐧",
				"🦉",
				"🦄",
				"🐝",
				"🦋",
				"🌸",
				"🌳",
				"🌈",
			],
		},
		{
			id: "food",
			icon: "🍕",
			label: () => m.chat_emoji_food(),
			emoji: [
				"🍎",
				"🍌",
				"🍉",
				"🍇",
				"🍓",
				"🍒",
				"🍑",
				"🍍",
				"🥑",
				"🍕",
				"🍔",
				"🍟",
				"🌭",
				"🍿",
				"🧀",
				"🥐",
				"🍞",
				"🍪",
				"🎂",
				"🍰",
				"🍫",
				"☕",
				"🍺",
				"🥂",
			],
		},
		{
			id: "activities",
			icon: "🎲",
			label: () => m.chat_emoji_activities(),
			emoji: [
				"🎲",
				"♟️",
				"🃏",
				"🎴",
				"🀄",
				"🧩",
				"🎯",
				"🎮",
				"🕹️",
				"🎳",
				"🏆",
				"🥇",
				"🥈",
				"🥉",
				"⚽",
				"🏀",
				"🏈",
				"⚾",
				"🎾",
				"🏐",
				"🎱",
				"🏓",
				"⛳",
				"🎪",
			],
		},
		{
			id: "objects",
			icon: "💡",
			label: () => m.chat_emoji_objects(),
			emoji: [
				"⌛",
				"⏰",
				"💡",
				"🔥",
				"⭐",
				"🌟",
				"✨",
				"⚡",
				"💥",
				"❄️",
				"🎁",
				"🎈",
				"🎉",
				"🎊",
				"📌",
				"✏️",
				"📖",
				"🔑",
				"🔒",
				"🛡️",
				"⚔️",
				"🔮",
				"💎",
				"🧭",
			],
		},
		{
			id: "symbols",
			icon: "❤️",
			label: () => m.chat_emoji_symbols(),
			emoji: [
				"❤️",
				"🧡",
				"💛",
				"💚",
				"💙",
				"💜",
				"🖤",
				"🤍",
				"💔",
				"💕",
				"💯",
				"✅",
				"❌",
				"⭕",
				"❗",
				"❓",
				"⚠️",
				"🚫",
				"➕",
				"➖",
				"🔁",
				"🆗",
				"🆒",
				"🏁",
			],
		},
	];

	let active = $state(initialRecent.length > 0 ? "recent" : "smileys");
	let tabs = $derived(recent.length > 0 ? categories : categories.filter((c) => c.id !== "recent"));
	let activeCategory = $derived(categories.find((c) => c.id === active) ?? categories[1]);

	let gridEl = $state<HTMLDivElement>();

	function pick(emoji: string) {
		recent = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
		if (browser) {
			try {
				localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
			} catch {
				// Quota/private-mode failures just lose the "recent" convenience.
			}
		}
		onpick(emoji);
	}

	// Roving arrow-key navigation inside the grid; Tab still moves between
	// tabs / grid / rest of the form as usual.
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
		const buttons = [...(gridEl?.querySelectorAll("button") ?? [])];
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
		if (next < 0 || next >= buttons.length) {
			return;
		}
		e.preventDefault();
		buttons[next].focus();
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

	// Move focus into the picker on open, per the disclosure pattern — the
	// caller restores focus to the chat input on close.
	$effect(() => {
		gridEl?.querySelector("button")?.focus();
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (keydown is Escape-only plumbing, the buttons inside are the interactive parts) -->
<div
	class="rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-600 dark:bg-gray-800"
	role="dialog"
	aria-label={m.chat_emoji_picker()}
	tabindex="-1"
	onkeydown={onRootKeydown}
	data-testid="emoji-picker"
>
	<div class="mb-1 flex gap-1 border-b border-gray-200 pb-1 dark:border-gray-700" role="tablist">
		{#each tabs as category (category.id)}
			<button
				type="button"
				role="tab"
				aria-selected={active === category.id}
				aria-label={category.label()}
				title={category.label()}
				class="flex-1 rounded-md py-1 text-base leading-none hover:bg-gray-100 dark:hover:bg-gray-700 {active ===
				category.id
					? 'bg-gray-200 dark:bg-gray-600'
					: ''}"
				onclick={() => (active = category.id)}
			>
				{category.icon}
			</button>
		{/each}
	</div>
	<div class="mb-1 px-1 text-xs font-medium text-gray-500 dark:text-gray-400">{activeCategory.label()}</div>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (arrow-key roving focus for the buttons inside) -->
	<div
		class="thin-scrollbar grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto"
		role="listbox"
		aria-label={activeCategory.label()}
		tabindex="-1"
		bind:this={gridEl}
		onkeydown={onGridKeydown}
	>
		{#each activeCategory.emoji as emoji (emoji)}
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
