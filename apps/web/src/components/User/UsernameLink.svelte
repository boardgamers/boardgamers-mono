<script lang="ts">
	import type { Snippet } from "svelte";
	import Portal from "@/modules/portal";
	import UserCard from "./UserCard.svelte";

	const OPEN_DELAY = 300;
	const CLOSE_DELAY = 150;
	const CARD_WIDTH = 288; // w-72
	const GAP = 8;

	let {
		username,
		userId = null,
		class: className = "",
		children,
		...rest
	}: {
		username: string;
		userId?: string | null;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	} = $props();

	let trigger: HTMLAnchorElement;
	let card: HTMLDivElement | undefined = $state();
	let open = $state(false);
	let style = $state("");

	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let id = 0;

	function clearTimers() {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
		openTimer = closeTimer = undefined;
	}

	function scheduleOpen() {
		if (open || openTimer) {
			return;
		}
		clearTimeout(closeTimer);
		closeTimer = undefined;
		openTimer = setTimeout(show, OPEN_DELAY);
	}

	function scheduleClose() {
		clearTimeout(openTimer);
		openTimer = undefined;
		if (open && !closeTimer) {
			closeTimer = setTimeout(hide, CLOSE_DELAY);
		}
	}

	function show() {
		clearTimers();
		open = true;
	}

	function hide() {
		clearTimers();
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && open) {
			event.stopPropagation();
			hide();
			trigger?.focus();
		}
	}

	// Position the card near the trigger, keeping it inside the viewport.
	$effect(() => {
		if (!open || !trigger || !card) {
			return;
		}
		const rect = trigger.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - CARD_WIDTH - GAP));
		const fitsBelow = rect.bottom + GAP + cardRect.height <= window.innerHeight - GAP;
		const placement =
			fitsBelow || rect.bottom >= window.innerHeight / 2
				? `top: ${Math.min(rect.bottom + GAP, Math.max(window.innerHeight - cardRect.height - GAP, GAP))}px;`
				: `bottom: ${Math.max(window.innerHeight - rect.top + GAP, GAP)}px;`;
		style = `left: ${left}px; ${placement}`;
	});

	$effect(() => {
		if (!open) {
			return;
		}
		const current = ++id;
		const onScrollOrResize = () => {
			if (current === id) {
				hide();
			}
		};
		window.addEventListener("scroll", onScrollOrResize, true);
		window.addEventListener("resize", onScrollOrResize);
		return () => {
			window.removeEventListener("scroll", onScrollOrResize, true);
			window.removeEventListener("resize", onScrollOrResize);
		};
	});

	$effect(() => () => clearTimers());
</script>

<a
	bind:this={trigger}
	href={`/user/${encodeURIComponent(username)}`}
	class={className}
	onmouseenter={scheduleOpen}
	onmouseleave={scheduleClose}
	onfocus={scheduleOpen}
	onblur={scheduleClose}
	onkeydown={onKeydown}
	{...rest}
>
	{#if children}{@render children()}{:else}{username}{/if}
</a>

{#if open}
	<Portal>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={card}
			role="tooltip"
			class="fixed z-[1300] w-72 overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10"
			{style}
			onmouseenter={scheduleOpen}
			onmouseleave={scheduleClose}
		>
			<UserCard {username} {userId} />
		</div>
	</Portal>
{/if}
