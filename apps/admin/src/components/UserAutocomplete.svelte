<script lang="ts">
	import { api } from "$lib/api.ts";

	interface UserResult {
		_id: string;
		account: { username: string; email: string };
	}

	interface Props {
		value: string;
		placeholder?: string;
		class?: string;
		// Z-index for the fixed-position dropdown (it must float above the
		// overflow-hidden card the input lives in).
		zIndex?: number;
		onselect?: (username: string) => void;
		onsubmit?: () => void;
	}

	let {
		value = $bindable(""),
		placeholder = "Username or email",
		class: className = "",
		zIndex = 50,
		onselect,
		onsubmit,
	}: Props = $props();

	let results: UserResult[] = $state([]);
	let selected = $state(0);
	let debounceId: ReturnType<typeof setTimeout> | undefined;
	// Incremented per search so a slow earlier response can't overwrite a newer one.
	let searchSeq = 0;
	let inputEl: HTMLInputElement | undefined = $state();
	let dropdownStyle = $state("");

	function positionDropdown() {
		if (!inputEl) return;
		const r = inputEl.getBoundingClientRect();
		dropdownStyle = `position: fixed; top: ${r.bottom + 4}px; left: ${r.left}px; width: ${r.width}px; z-index: ${zIndex};`;
	}

	function search() {
		clearTimeout(debounceId);
		debounceId = setTimeout(async () => {
			const seq = ++searchSeq;
			if (value.trim().length < 2) {
				results = [];
				return;
			}
			try {
				const found = await api.get<UserResult[]>(`/admin/users/search?search=${encodeURIComponent(value.trim())}`);
				if (seq === searchSeq) {
					results = found;
					selected = 0;
					positionDropdown();
				}
			} catch {
				if (seq === searchSeq) {
					results = [];
				}
			}
		}, 200);
	}

	function pick(username: string) {
		value = username;
		results = [];
		onselect?.(username);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === "ArrowDown" && results.length > 0) {
			e.preventDefault();
			selected = Math.min(selected + 1, results.length - 1);
		} else if (e.key === "ArrowUp" && results.length > 0) {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === "Enter") {
			if (results[selected]) {
				e.preventDefault();
				pick(results[selected].account.username);
			} else {
				onsubmit?.();
			}
		} else if (e.key === "Escape") {
			results = [];
		}
	}

	// Keep the fixed dropdown glued to the input while the page scrolls/resizes.
	$effect(() => {
		if (results.length === 0) return;
		const reposition = () => positionDropdown();
		window.addEventListener("scroll", reposition, true);
		window.addEventListener("resize", reposition);
		return () => {
			window.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", reposition);
		};
	});
</script>

<div class={className}>
	<input
		bind:this={inputEl}
		bind:value
		oninput={search}
		{onkeydown}
		onblur={() => setTimeout(() => (results = []), 150)}
		{placeholder}
		autocomplete="off"
		class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
	/>
</div>

{#if results.length > 0}
	<!-- Position:fixed (no transformed ancestors here), so this renders above the
	     overflow-hidden card the input lives in — an absolutely positioned
	     dropdown would be clipped by it. -->
	<div
		style={dropdownStyle}
		class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden"
	>
		{#each results as user, i (user._id)}
			<button
				type="button"
				class="w-full px-3 py-2 text-left text-sm transition-colors {i === selected
					? 'bg-blue-50 dark:bg-blue-900/30'
					: 'hover:bg-gray-50 dark:hover:bg-gray-800'}"
				onmousedown={(e) => {
					e.preventDefault();
					pick(user.account.username);
				}}
				onmouseenter={() => (selected = i)}
			>
				<span class="font-medium">{user.account.username}</span>
				<span class="ml-2 text-xs text-gray-500">{user.account.email}</span>
			</button>
		{/each}
	</div>
{/if}
