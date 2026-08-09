<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Snippet } from "svelte";
	import Portal from "@/modules/portal";
	import UserCard from "./UserCard.svelte";

	const OPEN_DELAY = 300;
	// Generous close delay: moving the pointer from the trigger onto the card crosses
	// an unhoverable gap, and the trigger link is usually thin, so the bridge must be
	// forgiving — the card has to stay open long enough to reach it.
	const CLOSE_DELAY = 400;
	const CARD_WIDTH = 288; // w-72
	const GAP = 8;
	// Transparent hover area around the card (px): the pointer counts as "inside" the
	// card while crossing the gap from the trigger, so leaving at a slight angle on
	// the way to the card doesn't fire the close timer. Applied as negative margin +
	// matching padding so it doesn't affect layout.
	const BRIDGE_PAD = 16;

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
	let pointerOverTrigger = false;
	let pointerOverCard = false;
	let id = 0;

	function clearTimers() {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
		openTimer = closeTimer = undefined;
	}

	function scheduleOpen() {
		// Clear any pending close first: when the card is already open, the early
		// return below must not leave a closeTimer running — e.g. card → trigger
		// re-entry within CLOSE_DELAY would otherwise close the card under the
		// pointer.
		clearTimeout(closeTimer);
		closeTimer = undefined;
		if (open || openTimer) {
			return;
		}
		openTimer = setTimeout(show, OPEN_DELAY);
	}

	function scheduleClose() {
		clearTimeout(openTimer);
		openTimer = undefined;
		if (open && !closeTimer) {
			closeTimer = setTimeout(hide, CLOSE_DELAY);
		}
	}

	function onTriggerEnter() {
		pointerOverTrigger = true;
		scheduleOpen();
	}

	function onTriggerLeave() {
		pointerOverTrigger = false;
		scheduleClose();
	}

	function onCardEnter() {
		pointerOverCard = true;
		clearTimeout(closeTimer);
		closeTimer = undefined;
	}

	function onCardLeave() {
		pointerOverCard = false;
		// A fast flick trigger → card → trigger can finish before the 300ms open
		// delay elapses, leaving no timer pending and the card stuck open once it
		// does appear. Queue a close whenever the pointer is on neither element.
		if (!pointerOverTrigger) {
			scheduleClose();
		}
	}

	function show() {
		clearTimers();
		open = true;
	}

	function hide() {
		clearTimers();
		pointerOverTrigger = pointerOverCard = false;
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
		// Placed above, the card is flush against the trigger (no dead gap) so the
		// pointer crosses onto it seamlessly; below, the transparent bridge padding
		// on the wrapper covers the GAP.
		const placement =
			fitsBelow || rect.bottom >= window.innerHeight / 2
				? `top: ${Math.min(rect.bottom + GAP, Math.max(window.innerHeight - cardRect.height - GAP, GAP))}px;`
				: `top: ${Math.max(rect.top - cardRect.height, GAP)}px;`;
		style = `left: ${left}px; ${placement} margin: -${BRIDGE_PAD}px; padding: ${BRIDGE_PAD}px;`;
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
	href={resolve("/(app)/user/[username]", { username })}
	class={className}
	onmouseenter={onTriggerEnter}
	onmouseleave={onTriggerLeave}
	onfocus={scheduleOpen}
	onblur={scheduleClose}
	onkeydown={onKeydown}
	{...rest}
>
	{#if children}{@render children()}{:else}{username}{/if}
</a>

{#if open}
	<Portal>
		<!-- The negative margin + padding (see BRIDGE_PAD) is a transparent hover
			bridge: it keeps the pointer "inside" the card while crossing the gap
			from the trigger. -->
		<div
			bind:this={card}
			role="tooltip"
			class="fixed z-[1300]"
			{style}
			onmouseenter={onCardEnter}
			onmouseleave={onCardLeave}
		>
			<div
				class="w-72 overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10"
			>
				<UserCard {username} {userId} />
			</div>
		</div>
	</Portal>
{/if}
