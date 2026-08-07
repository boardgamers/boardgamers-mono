<script lang="ts">
	import { account, currentGameId, sidebarOpen, chatMessages } from "@/lib/stores.svelte";
	import { get, post } from "@/lib/api";
	import { Modal, ModalHeader, ModalFooter, Input, InputGroup, Button, Badge } from "@/modules/cdk";
	import IconChat from "@/components/icons/IconChat.svelte";
	import { dateFromObjectId, handleError } from "@/utils";
	import { fly } from "svelte/transition";
	import UserAvatar from "./User/UserAvatar.svelte";
	import UsernameLink from "./User/UsernameLink.svelte";

	let isOpen = $state(false);
	let toggle = () => {
		isOpen = !isOpen;
	};
	let lastRead = $state(0);
	let { room }: { room: string } = $props();

	let currentMessage = $state("");

	const sendMessage = async () => {
		console.log("send message");
		const msg = currentMessage;
		currentMessage = "";

		// Mark message as delivered? by adding meta: 'Delivered'
		return post(`/game/${room}/chat`, {
			author: "me",
			data: {
				text: msg,
			},
			type: "text",
		}).catch(handleError);
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
	let unreadMessages = $derived(
		$chatMessages.filter((msg) => msg.type !== "system" && !!msg._id && dateFromObjectId(msg._id).getTime() > lastRead)
			.length
	);

	// Close on Escape while the chat is open.
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
	class={"chat-modal" + ($sidebarOpen ? " sidebar-open" : "")}
>
	<ModalHeader {toggle} class="gap-2">
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
				<div class="mb-3 flex items-end gap-2 {sent ? 'flex-row-reverse' : ''}">
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
					<div
						class="max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-snug whitespace-pre-wrap {sent
							? 'rounded-br-md bg-blue-500 text-white'
							: 'rounded-bl-md bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'}"
						title={"Sent at " + chatTime(message._id)}
					>
						{message.data.text}
					</div>
				</div>
			{/if}
		{/each}
	</div>
	<ModalFooter class="p-3">
		<form
			onsubmit={(e) => {
				e.preventDefault();
				sendMessage();
			}}
			class="w-full"
		>
			<InputGroup>
				<Input type="text" bind:value={currentMessage} placeholder="Type a message…" />
				<Button type="submit" color="primary">Send</Button>
			</InputGroup>
		</form>
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
