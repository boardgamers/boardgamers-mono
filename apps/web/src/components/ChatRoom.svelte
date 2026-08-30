<script lang="ts">
	import type { ChatMessageFront } from "@bgs/models";
	import { account, currentGameId, sidebarOpen, chatMessages } from "@/lib/stores.svelte";
	import { get, patch, post } from "@/lib/api";
	import { Modal, ModalHeader, ModalFooter, Input, InputGroup, Button, Badge } from "@/modules/cdk";
	import IconChat from "@/components/icons/IconChat.svelte";
	import IconPencil from "@/components/icons/IconPencil.svelte";
	import { countUnreadMessages, dateFromObjectId, handleError } from "@/utils";
	import { fly } from "svelte/transition";
	import UserAvatar from "./User/UserAvatar.svelte";
	import UsernameLink from "./User/UsernameLink.svelte";
	import ChatInput from "./ChatInput.svelte";
	import { m } from "@/lib/i18n/messages";

	let isOpen = $state(false);
	let toggle = () => {
		isOpen = !isOpen;
	};
	let lastRead = $state(0);
	let { room }: { room: string } = $props();

	const sendMessage = async (msg: string) => {
		// Mark message as delivered? by adding meta: 'Delivered'
		return post(`/game/${room}/chat`, {
			author: "me",
			data: {
				text: msg,
			},
			type: "text",
		}).catch(handleError);
	};

	// Mirrors the API's edit window — the pencil hides when a PATCH would be rejected anyway.
	const EDIT_WINDOW_MS = 15 * 60 * 1000;

	let editingId = $state<string | null>(null);
	let editText = $state("");

	function canEdit(message: ChatMessageFront): boolean {
		return (
			message.type === "text" &&
			!!message._id &&
			message.author?._id === userId &&
			Date.now() - dateFromObjectId(message._id).getTime() < EDIT_WINDOW_MS
		);
	}

	function startEdit(message: ChatMessageFront) {
		editingId = message._id ?? null;
		editText = message.data.text;
	}

	const saveEdit = async () => {
		const id = editingId;
		const text = editText.trim();
		editingId = null;
		if (!id || !text) {
			return;
		}
		// No optimistic update: the ws poller re-sends the edited message within ~250ms.
		return patch(`/game/${room}/chat/${id}`, { data: { text } }).catch(handleError);
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
			lastRead = await get(`/game/${room}/chat/lastRead`);
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
			await post(`/game/${room}/chat/lastRead`, { lastRead }).catch(handleError);
		}
	}

	let userId = $derived($account?._id);
	$effect(() => {
		$chatMessages;
		isOpen;
		onMessagesChanged();
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
		<span class="truncate font-semibold">{$currentGameId}</span>
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
									autofocus
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
						<div
							class="max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-snug whitespace-pre-wrap {sent
								? 'rounded-br-md bg-blue-500 text-white'
								: 'rounded-bl-md bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'}"
							title={m.chat_sentAt({ time: chatTime(message._id) })}
						>
							{message.data.text}
							{#if message.editedAt}
								<span class="ml-1 text-xs italic opacity-70">{m.chat_edited()}</span>
							{/if}
						</div>
						{#if canEdit(message)}
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
		<ChatInput onsend={sendMessage} />
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
