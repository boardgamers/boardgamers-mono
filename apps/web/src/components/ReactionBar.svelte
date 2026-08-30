<script lang="ts">
	import { del, put } from "@/lib/api";
	import { account, chatReactions } from "@/lib/stores.svelte";
	import { chatApiBase, handleError } from "@/utils";
	// Subpath import: the @bgs/models root pulls mongodb into the browser bundle.
	import { CHAT_REACTION_EMOJI, CHAT_REACTION_QUICK, type ChatReactionAggregate } from "@bgs/models/chatreaction-emoji";
	import IconEmojiSmile from "@/components/icons/IconEmojiSmile.svelte";
	import { m } from "@/lib/i18n/messages";

	// Renders inside a `relative` flex-col wrapper around the message bubble, in a
	// message row carrying the `group` class (hover reveals the add button).
	// `editAffordance` / `deleteAffordance`: the row also shows the edit pencil
	// and/or the admin delete button beside the bubble — shift the add button
	// away so they don't overlap (they're flex siblings of the bubble column,
	// this overlay is absolute at the same spot).
	let {
		messageId,
		room,
		mine = false,
		editAffordance = false,
		deleteAffordance = false,
	}: {
		messageId: string;
		room: string;
		mine?: boolean;
		editAffordance?: boolean;
		deleteAffordance?: boolean;
	} = $props();

	// One row button ≈ 2rem of clearance; two need 3.5rem.
	let sideButtons = $derived((editAffordance ? 1 : 0) + (deleteAffordance ? 1 : 0));
	let addButtonOffset = $derived(
		mine
			? sideButtons === 2
				? "right-full mr-14"
				: sideButtons === 1
					? "right-full mr-8"
					: "right-full mr-1"
			: sideButtons > 0
				? "left-full ml-8"
				: "left-full ml-1"
	);

	// Chips are out of flow (absolute), so a long list can't wrap into extra
	// overlay lines — cap the row and fold the rest into a "+N" summary chip.
	const MAX_CHIPS = 5;

	let pickerOpen = $state(false);
	let showAll = $state(false);
	let container: HTMLDivElement | undefined = $state();

	let reactions = $derived($chatReactions[messageId] ?? []);
	let userId = $derived($account?._id);

	type ReactionGroup = ChatReactionAggregate["reactions"][number];

	function ownReaction(group: ReactionGroup | undefined): boolean {
		return !!userId && !!group?.users.some((u) => u._id === userId);
	}

	function tooltip(group: ReactionGroup): string {
		return m.chat_reactionTooltip({ emoji: group.emoji, names: group.users.map((u) => u.name).join(", ") });
	}

	async function toggle(emoji: string) {
		pickerOpen = false;
		showAll = false;
		if (!userId) {
			return;
		}
		const set = !ownReaction(reactions.find((group) => group.emoji === emoji));
		const url = `${chatApiBase(room)}/chat/${messageId}/reaction/${encodeURIComponent(emoji)}`;
		// The websocket pushes the same aggregate to everyone in the room; applying
		// the response too just makes the toggler's own click feel instant.
		const updated = await (set ? put<ChatReactionAggregate>(url) : del<ChatReactionAggregate>(url)).catch(handleError);
		if (updated) {
			chatReactions.update((current) => {
				const next = { ...current };
				if (updated.reactions.length > 0) {
					next[updated.message] = updated.reactions;
				} else {
					delete next[updated.message];
				}
				return next;
			});
		}
	}

	// Close the picker on outside click / Escape. Capture phase so Escape closes
	// only the picker, not also the chat modal (ChatRoom listens on document).
	$effect(() => {
		if (!pickerOpen) {
			return;
		}
		const onClick = (e: MouseEvent) => {
			if (container && !container.contains(e.target as Node)) {
				pickerOpen = false;
				showAll = false;
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				pickerOpen = false;
				showAll = false;
			}
		};
		document.addEventListener("click", onClick, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("keydown", onKey, true);
		};
	});
</script>

{#if userId}
	<div bind:this={container} class="absolute top-1/2 -translate-y-1/2 {addButtonOffset}">
		<button
			type="button"
			class="rounded-full p-1 text-gray-400 transition-opacity hover:text-gray-600 focus-visible:opacity-100 dark:text-gray-500 dark:hover:text-gray-300 pointer-coarse:opacity-70 {pickerOpen
				? 'opacity-100'
				: 'opacity-0 group-hover:opacity-100'}"
			title={m.chat_addReaction()}
			aria-label={m.chat_addReaction()}
			aria-expanded={pickerOpen}
			onclick={() => {
				pickerOpen = !pickerOpen;
				showAll = false;
			}}
		>
			<IconEmojiSmile size="1.1rem" />
		</button>
		{#if pickerOpen}
			<!-- Grows over the bubble (mine: rightwards, others: leftwards) so it never
			     overflows the chat modal's horizontal edges. -->
			<div
				class="absolute bottom-full z-10 mb-1 flex w-max max-w-52 flex-wrap gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-600 dark:bg-gray-800 {mine
					? 'left-0'
					: 'right-0'}"
				role="menu"
			>
				{#each showAll ? CHAT_REACTION_EMOJI : CHAT_REACTION_QUICK as emoji (emoji)}
					<button
						type="button"
						class="rounded p-1 text-lg leading-none hover:bg-gray-100 dark:hover:bg-gray-700"
						onclick={() => toggle(emoji)}
					>
						{emoji}
					</button>
				{/each}
				{#if !showAll}
					<button
						type="button"
						class="rounded p-1 text-lg leading-none text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
						title={m.chat_moreReactions()}
						aria-label={m.chat_moreReactions()}
						onclick={() => (showAll = true)}
					>
						+
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

{#if reactions.length > 0}
	{@const visible = reactions.length > MAX_CHIPS ? reactions.slice(0, MAX_CHIPS - 1) : reactions}
	{@const hidden = reactions.slice(visible.length)}
	<!-- Chips overlap the bubble's bottom edge (mock in #442, -mt-2 look) but are
	     OUT of flow (absolute in the `relative` bubble wrapper): reacting never
	     moves any message. Trade-off (accepted): the protruding half may overlay
	     the next message, so the row never wraps — beyond MAX_CHIPS it folds into
	     a "+N" chip (hidden emojis stay toggleable through the picker). `w-max`
	     keeps narrow bubbles from squishing the chips; z-[1] paints them above
	     the neighbouring bubbles; mirrored to the bottom-right on own bubbles. -->
	<div class="absolute top-full z-[1] -mt-2 flex w-max gap-1 {mine ? 'right-1.5' : 'left-1.5'}">
		{#each visible as group (group.emoji)}
			<button
				type="button"
				class="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs leading-none transition-colors {ownReaction(
					group
				)
					? 'border-blue-400 bg-blue-100 dark:border-blue-500 dark:bg-blue-900'
					: 'border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-700'} {userId
					? ownReaction(group)
						? 'hover:bg-blue-200 dark:hover:bg-blue-800'
						: 'hover:bg-gray-200 dark:hover:bg-gray-600'
					: 'cursor-default'}"
				title={tooltip(group)}
				disabled={!userId}
				onclick={() => toggle(group.emoji)}
			>
				<span class="text-sm leading-none">{group.emoji}</span>
				<span class="font-medium text-gray-700 dark:text-gray-200">{group.users.length}</span>
			</button>
		{/each}
		{#if hidden.length > 0}
			<span
				class="flex items-center rounded-full border border-gray-300 bg-gray-100 px-1.5 py-0.5 text-xs leading-none font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
				title={hidden.map(tooltip).join("\n")}
			>
				+{hidden.length}
			</span>
		{/if}
	</div>
{/if}
