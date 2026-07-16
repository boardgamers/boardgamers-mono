<script lang="ts">
  import { account, currentGameId, sidebarOpen, chatMessages } from "@/lib/stores.svelte";
  import { get, post } from "@/lib/api";
  import { Modal, ModalHeader, ModalFooter, Input, InputGroup, Button, Badge } from "@/modules/cdk";
  import IconChat from "@/components/icons/IconChat.svelte";
  import { dateFromObjectId, dateTime, handleError } from "@/utils";
  import { fly } from "svelte/transition";
  import UserAvatar from "./User/UserAvatar.svelte";

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
    $chatMessages.filter((msg) => msg.type !== "system" && dateFromObjectId(msg._id).getTime() > lastRead).length
  );
</script>

<Modal
  {isOpen}
  {toggle}
  backdrop={false}
  transitionType={fly}
  transitionOptions={{ y: -300 }}
  class={"chat-modal" + ($sidebarOpen ? " sidebar-open" : "")}
>
  <ModalHeader {toggle}
    ><IconChat style="height: 1.5rem; vertical-align: -0.25rem" /> {$currentGameId}</ModalHeader
  >
  <div class="chat-messages" bind:this={messagesContainer}>
    {#each $chatMessages as message}
      <div class="message-container" class:sent={message.author?._id === userId}>
        {#if message.author}
          <UserAvatar userId={message.author._id} username={message.author.name} size="3rem" />
        {/if}
        <div
          class="message"
          class:system={message.type === "system"}
          title={"Sent at " + dateTime(dateFromObjectId(message._id))}
        >
          {message.data.text}
          {#if !message.author}
            <p class="message-meta">
              {dateTime(dateFromObjectId(message._id))}
            </p>
          {/if}
        </div>
        <span class="mx-4"></span>
      </div>
    {/each}
    <span style="height: 0">&nbsp;</span>
  </div>
  <ModalFooter>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        sendMessage(e);
      }}
      style="width: 100%"
    >
      <InputGroup>
        <Input type="text" bind:value={currentMessage} />
        <Button type="submit" color="secondary" outline>Send</Button>
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
