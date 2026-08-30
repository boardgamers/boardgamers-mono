<script lang="ts">
	import type { ChatMessageFront } from "@bgs/models";
	import { account, currentGameId, sidebarOpen, chatMessages, chatReactions } from "@/lib/stores.svelte";
	import { get, patch, post } from "@/lib/api";
	import { Modal, ModalHeader, ModalFooter, Input, InputGroup, Button, Badge } from "@/modules/cdk";
	import IconChat from "@/components/icons/IconChat.svelte";
	import IconPencil from "@/components/icons/IconPencil.svelte";
	import {
		canEditMessage,
		chatApiBase,
		countUnreadMessages,
		dateFromObjectId,
		handleError,
		isPinnedToBottom,
		lastEditableMessage,
		shouldScrollChatToBottom,
		type ChatScrollState,
	} from "@/utils";
	import { flushSync, tick } from "svelte";
	import { fly } from "svelte/transition";
	import ReactionBar from "./ReactionBar.svelte";
	import UserAvatar from "./User/UserAvatar.svelte";
	import UsernameLink from "./User/UsernameLink.svelte";
	import ChatInput from "./ChatInput.svelte";
	import { m } from "@/lib/i18n/messages";

	let isOpen = $state(false);
	let toggle = () => {
		isOpen = !isOpen;
	};
	let lastRead = $state(0);
	// `title` defaults to the room id (the game id) — the lobby passes a translated label.
	let { room, title }: { room: string; title?: string } = $props();

	// Game rooms → /game/:gameId/chat…, public rooms (lobby) → /room/:roomId/chat….
	let apiBase = $derived(chatApiBase(room));

	const sendMessage = async (msg: string) => {
		// Mark message as delivered? by adding meta: 'Delivered'
		return post(`${apiBase}/chat`, {
			author: "me",
			data: {
				text: msg,
			},
			type: "text",
		}).catch(handleError);
	};

	let editingId = $state<string | null>(null);
	let editText = $state("");
	let editInputElement = $state<HTMLInputElement | HTMLTextAreaElement>();

	function startEdit(message: ChatMessageFront) {
		editingId = message._id ?? null;
		editText = message.data.text;
		// Render the editor now, then move focus into it with the caret at the end.
		flushSync();
		// Always a text <input> here (no instanceof: jsdom tests run cross-realm).
		const el = editInputElement as HTMLInputElement | undefined;
		el?.focus();
		el?.setSelectionRange(editText.length, editText.length);
	}

	// Discord-style ArrowUp in the (empty) chat input: edit the most recent editable
	// message that isn't already being edited. Returns whether an editor was opened.
	function editLastMessage(): boolean {
		const last = lastEditableMessage($chatMessages, userId, editingId);
		if (!last) {
			return false;
		}
		startEdit(last);
		return true;
	}

	const saveEdit = async () => {
		const id = editingId;
		const text = editText.trim();
		editingId = null;
		if (!id || !text) {
			return;
		}
		// No optimistic update: the ws poller re-sends the edited message within ~250ms.
		return patch(`${apiBase}/chat/${id}`, { data: { text } }).catch(handleError);
	};

	let messagesContainer: HTMLDivElement;

	function onMessagesChanged() {
		setTimeout(() => {
			if (messagesContainer) {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			}
		});

		if (isOpen) {
			postLastRead();
		}
	}

	async function loadLastRead() {
		if (userId) {
			lastRead = await get(`${apiBase}/chat/lastRead`);
		} else {
			lastRead = 0;
		}
	}

	async function postLastRead() {
		const lastMessage = $chatMessages.slice(-1).pop();

		if (!lastMessage) {
			return;
		}

		if (!lastMessage._id) {
			return;
		}

		const lastMessageTime = dateFromObjectId(lastMessage._id).getTime();

		if (lastMessageTime <= lastRead) {
			return;
		}

		lastRead = Date.now();

		if (userId) {
			await post(`${apiBase}/chat/lastRead`, { lastRead }).catch(handleError);
		}
	}

	let userId = $derived($account?._id);
	// Force-scroll to the bottom only when the chat opens or a NEW message lands
	// at the end — never for in-place updates (edits re-pushed by the ws), which
	// must not yank the view down while the user reads history.
	let scrollState: ChatScrollState | undefined;
	$effect(() => {
		const next: ChatScrollState = { lastId: $chatMessages.at(-1)?._id, open: isOpen };
		if (shouldScrollChatToBottom(scrollState, next)) {
			onMessagesChanged();
		}
		scrollState = next;
	});
	// Edits growing a message row must not detach the bottom anchor: measured
	// BEFORE the DOM updates ($effect.pre), a view pinned to the bottom is
	// re-pinned after the update. Reaction chips are out of flow (absolute) so
	// they no longer change heights, but a wrapping edit still does — and the
	// re-pin keeps chips protruding below the last bubble fully in view.
	// When scrolled up, scrollTop is left alone.
	// jsdom has no layout (scroll metrics are all 0), so this is browser-verified.
	$effect.pre(() => {
		$chatReactions;
		$chatMessages;
		const el = messagesContainer;
		if (el && isPinnedToBottom(el)) {
			tick().then(() => {
				el.scrollTop = el.scrollHeight;
			});
		}
	});
	$effect(() => {
		userId;
		room;
		loadLastRead();
	});
	let unreadMessages = $derived(countUnreadMessages($chatMessages, lastRead, userId));

	// Close on Escape while the chat is open. (Escapes pressed while the emoji
	// picker is open with focus in the input row are swallowed there.)
	$effect(() => {
		if (!isOpen) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && (isOpen = false);
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	});

	// Friendly locale timestamp, e.g. "Jul 23, 12:22 AM".
	function chatTime(objectId: string | undefined): string {
		if (!objectId) {
			return "";
		}
		return dateFromObjectId(objectId).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	}
</script>

<Modal
	{isOpen}
	{toggle}
	backdrop
	backdropClassName="!bg-transparent"
	transitionType={fly}
	transitionOptions={{ y: -300 }}
	modalClassName="chat-modal-root"
	class={"chat-modal" + ($sidebarOpen ? " sidebar-open" : "")}
>
	<ModalHeader {toggle} class="shrink-0 gap-2">
		<IconChat size="1.25rem" class="shrink-0 text-gray-400" />
		<span class="truncate font-semibold">{title ?? $currentGameId}</span>
	</ModalHeader>
	<div class="chat-messages thin-scrollbar" bind:this={messagesContainer}>
		{#each $chatMessages as message (message._id)}
			{#if message.type === "system"}
				<div class="my-3 text-center text-xs text-gray-400 italic" title={chatTime(message._id)}>
					{message.data.text}
					<span class="ml-1 not-italic opacity-60">· {chatTime(message._id)}</span>
				</div>
			{:else}
				{@const sent = message.author?._id === userId}
				<div class="group mb-3 flex items-end gap-2 {sent ? 'flex-row-reverse' : ''}">
					{#if message.author}
						<UsernameLink
							username={message.author.name}
							userId={message.author._id}
							class="shrink-0"
							title={message.author.name}
							tabindex="-1"
						>
							<UserAvatar userId={message.author._id} username={message.author.name} size="2.5rem" />
						</UsernameLink>
					{/if}
					{#if editingId === message._id}
						<form
							class="max-w-[75%] flex-1"
							onsubmit={(e) => {
								e.preventDefault();
								saveEdit();
							}}
						>
							<InputGroup>
								<Input
									type="text"
									bind:value={editText}
									bind:element={editInputElement}
									class="text-base"
									onkeydown={(e: KeyboardEvent) => {
										if (e.key === "Escape") {
											// Don't let the modal's document-level Escape handler close the chat
											e.stopPropagation();
											editingId = null;
										}
									}}
								/>
								<Button type="submit" color="primary">{m.common_save()}</Button>
								<Button type="button" color="secondary" onclick={() => (editingId = null)}>{m.common_cancel()}</Button>
							</InputGroup>
						</form>
					{:else}
						<div class="relative flex max-w-[75%] flex-col {sent ? 'items-end' : 'items-start'}">
							<div
								class="rounded-2xl px-3 py-2 text-sm leading-snug whitespace-pre-wrap {sent
									? 'rounded-br-md bg-blue-500 text-white'
									: 'rounded-bl-md bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'}"
								title={m.chat_sentAt({ time: chatTime(message._id) })}
							>
								{message.data.text}
								{#if message.editedAt}
									<span class="ml-1 text-xs italic opacity-70">{m.chat_edited()}</span>
								{/if}
							</div>
							{#if message._id}
								<ReactionBar
									messageId={message._id}
									{room}
									mine={sent}
									editAffordance={canEditMessage(message, userId)}
								/>
							{/if}
						</div>
						{#if canEditMessage(message, userId)}
							<button
								type="button"
								class="invisible shrink-0 self-center p-1 text-gray-400 group-hover:visible hover:text-gray-600 focus-visible:visible dark:hover:text-gray-200"
								title={m.common_edit()}
								aria-label={m.common_edit()}
								onclick={() => startEdit(message)}
							>
								<IconPencil size="0.875rem" />
							</button>
						{/if}
					{/if}
				</div>
			{/if}
		{/each}
	</div>
	<ModalFooter class="shrink-0 p-3">
		<ChatInput onsend={sendMessage} oneditlast={editLastMessage} />
	</ModalFooter>
</Modal>

<Button
	color="primary"
	onclick={toggle}
	class={"!rounded-full sidebar-fab chat-button" + ($sidebarOpen ? " sidebar-open" : "")}
>
	<IconChat size="1.5rem" />
	{#if unreadMessages}
		<Badge pill color="danger">{unreadMessages}</Badge>
	{/if}
</Button>
