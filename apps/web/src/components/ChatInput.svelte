<script lang="ts">
	import { Input, InputGroup, Button } from "@/modules/cdk";
	import { m } from "@/lib/i18n/messages";
	import { flushSync } from "svelte";

	let {
		onsend,
		oneditlast,
	}: {
		onsend: (text: string) => void;
		// Discord-style ArrowUp-to-edit hook: called on ArrowUp in an empty input; returns
		// whether it consumed the key (the owner opened an editor). Optional — ChatInput
		// stays agnostic of chat messages.
		oneditlast?: () => boolean;
	} = $props();

	let currentMessage = $state("");

	// Emoji picker (lazy-loaded on first open — see the {#await import} below).
	let pickerOpen = $state(false);
	let inputElement = $state<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
	let inputRow = $state<HTMLFormElement>();

	function closePicker(refocusInput = true) {
		pickerOpen = false;
		if (refocusInput) {
			inputElement?.focus();
		}
	}

	// Insert at the caret (replacing any selection), not at the end.
	function insertEmoji(emoji: string) {
		// Always a text <input> here (no instanceof: jsdom tests run cross-realm).
		const el = inputElement as HTMLInputElement | undefined;
		const start = el?.selectionStart ?? currentMessage.length;
		const end = el?.selectionEnd ?? currentMessage.length;
		currentMessage = currentMessage.slice(0, start) + emoji + currentMessage.slice(end);
		// Push the new value to the DOM before restoring the caret — setting
		// .value after setSelectionRange would snap the caret to the end.
		flushSync();
		el?.focus();
		el?.setSelectionRange(start + emoji.length, start + emoji.length);
	}

	// Close the picker on any pointer press outside the input row (the row
	// contains the picker, the 🙂 toggle and the input).
	$effect(() => {
		if (!pickerOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (inputRow && !inputRow.contains(e.target as Node)) {
				closePicker(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (keydown is Escape-only plumbing for the picker; the controls inside are the interactive parts) -->
<form
	onsubmit={(e) => {
		e.preventDefault();
		closePicker(false);
		const msg = currentMessage;
		currentMessage = "";
		onsend(msg);
	}}
	onkeydown={(e) => {
		// Esc with focus in the input row closes only the picker, not the
		// chat — stopPropagation keeps it from the chat Modal's Esc handlers.
		if (e.key === "Escape" && pickerOpen) {
			e.stopPropagation();
			e.preventDefault();
			closePicker();
		}
	}}
	class="relative w-full"
	bind:this={inputRow}
>
	<InputGroup>
		<Button
			type="button"
			aria-label={m.chat_emoji_button()}
			aria-expanded={pickerOpen}
			title={m.chat_emoji_button()}
			class="px-3"
			onclick={() => (pickerOpen ? closePicker(false) : (pickerOpen = true))}
		>
			🙂
		</Button>
		<!-- text-base: iOS Safari zooms the page on focus of inputs smaller than 16px -->
		<Input
			type="text"
			bind:value={currentMessage}
			bind:element={inputElement}
			placeholder={m.chat_placeholder()}
			class="text-base"
			onkeydown={(e: KeyboardEvent) => {
				// Empty input only — with text present ArrowUp keeps its native caret behavior.
				if (e.key === "ArrowUp" && currentMessage === "" && !pickerOpen && oneditlast?.()) {
					e.preventDefault();
				}
			}}
		/>
		<Button type="submit" color="primary">{m.chat_send()}</Button>
	</InputGroup>
	<!-- After the InputGroup in DOM order (Tab reaches it last); positioned above the input. -->
	{#if pickerOpen}
		<div class="absolute right-0 bottom-full left-0 z-10 mb-2">
			{#await import("./ChatEmojiPicker.svelte") then { default: ChatEmojiPicker }}
				<ChatEmojiPicker onpick={insertEmoji} onclose={() => closePicker()} />
			{/await}
		</div>
	{/if}
</form>
