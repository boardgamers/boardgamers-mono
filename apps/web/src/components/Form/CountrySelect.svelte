<script lang="ts">
	import { countries, countryFlag, filterCountries } from "@/lib/countries";

	let {
		value = "",
		id = undefined,
		placeholder = "🌍 Search your country…",
		onselect,
	}: {
		value?: string;
		id?: string;
		placeholder?: string;
		onselect: (code: string) => void;
	} = $props();

	let open = $state(false);
	let query = $state("");
	// -1 = no option highlighted yet; Enter then picks the first match.
	let activeIndex = $state(-1);
	let inputEl = $state<HTMLInputElement>();
	let rootEl = $state<HTMLDivElement>();

	const listId = $derived(`${id ?? "country-select"}-listbox`);
	const optionId = (index: number) => `${listId}-option-${index}`;

	let selected = $derived(countries.find((c) => c.code === value));
	let matches = $derived(filterCountries(query));

	function openList() {
		open = true;
		activeIndex = -1;
	}

	function closeList() {
		open = false;
		query = "";
	}

	function select(code: string) {
		closeList();
		onselect(code);
	}

	function clear() {
		closeList();
		onselect("");
		inputEl?.focus();
	}

	function scrollActiveIntoView() {
		if (activeIndex >= 0) {
			document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			if (!open) {
				openList();
			} else {
				activeIndex = Math.min(activeIndex + 1, matches.length - 1);
				scrollActiveIntoView();
			}
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			if (open) {
				activeIndex = Math.max(activeIndex - 1, 0);
				scrollActiveIntoView();
			}
		} else if (event.key === "Enter") {
			if (open) {
				event.preventDefault();
				const match = matches[activeIndex >= 0 ? activeIndex : 0];
				if (match) {
					select(match.code);
				}
			}
		} else if (event.key === "Escape" && open) {
			event.preventDefault();
			event.stopPropagation();
			closeList();
		} else if (event.key === "Tab") {
			closeList();
		}
	}
</script>

<svelte:window
	onpointerdown={(event) => {
		if (open && rootEl && !rootEl.contains(event.target as Node)) {
			closeList();
		}
	}}
/>

<div bind:this={rootEl} class="relative">
	<input
		bind:this={inputEl}
		{id}
		type="text"
		role="combobox"
		aria-expanded={open}
		aria-controls={listId}
		aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
		aria-autocomplete="list"
		autocomplete="off"
		class="w-full cursor-pointer rounded-md border border-gray-300 px-3 py-2 pr-9 text-sm focus:cursor-text dark:border-gray-600 dark:bg-gray-800"
		class:italic={!selected && !open}
		placeholder={selected ? `${countryFlag(selected.code)} ${selected.name}` : placeholder}
		value={open ? query : selected ? `${countryFlag(selected.code)} ${selected.name}` : ""}
		onfocus={openList}
		oninput={(event) => {
			query = event.currentTarget.value;
			activeIndex = -1;
			open = true;
		}}
		{onkeydown}
	/>
	{#if selected && !open}
		<button
			type="button"
			class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none dark:hover:bg-gray-700 dark:hover:text-gray-200"
			aria-label="Clear country"
			title="Clear country"
			onpointerdown={(event) => event.preventDefault()}
			onclick={clear}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				width="0.9em"
				height="0.9em"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"
				/>
			</svg>
		</button>
	{/if}
	{#if open}
		<ul
			id={listId}
			role="listbox"
			aria-label="Countries"
			class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-300 bg-white py-1 text-sm shadow-lg dark:border-gray-600 dark:bg-gray-800"
		>
			{#each matches as c, i (c.code)}
				<!-- Keyboard interaction lives on the combobox input (ArrowUp/Down/Enter/Escape), per the ARIA combobox pattern. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optionId(i)}
					role="option"
					aria-selected={c.code === value}
					class="flex cursor-pointer items-center gap-2 px-3 py-1.5 {i === activeIndex
						? 'bg-gray-100 dark:bg-gray-700'
						: ''} {c.code === value ? 'font-semibold' : ''}"
					onpointerdown={(event) => event.preventDefault()}
					onclick={() => select(c.code)}
					onpointerenter={() => (activeIndex = i)}
				>
					<span aria-hidden="true">{countryFlag(c.code)}</span>
					<span>{c.name}</span>
				</li>
			{:else}
				<li class="px-3 py-2 text-gray-500 dark:text-gray-400">No country matches “{query}”</li>
			{/each}
		</ul>
	{/if}
</div>
