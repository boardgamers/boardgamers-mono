<script lang="ts">
  import chat from "@iconify/icons-bi/chat.js";
  import { useAccount } from "@/composition/useAccount";
  import { useCurrentGame } from "@/composition/useCurrentGame";
  import { useCurrentRoom } from "@/composition/useCurrentRoom";
  import { useRest } from "@/composition/useRest";
  import { useSidebarOpen } from "@/composition/useSidebarOpen";
  import { Modal, ModalHeader, Icon, ModalFooter, Input, InputGroup, Button, Badge } from "@/modules/cdk";
  import { dateFromObjectId, dateTime, handleError } from "@/utils";
  import { fly } from "svelte/transition";
  import UserAvatar from "./User/UserAvatar.svelte";

  const { get, post } = useRest();
  const { account } = useAccount();
  const { currentGameId } = useCurrentGame();
  const { sidebarOpen } = useSidebarOpen();
  const { chatMessages } = useCurrentRoom();

  let isOpen = false;
  let toggle = () => {
    isOpen = !isOpen;
  };
  let lastRead: number = 0;
  export let room: string;

  let currentMessage = "";

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

  let messagesContainer: ModalBody;

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

  $: userId = $account?._id;
  $: onMessagesChanged(), [$chatMessages, isOpen];
  $: loadLastRead(), [userId, room];
  $: unreadMessages = $chatMessages.filter(
    (msg) => msg.type !== "system" && dateFromObjectId(msg._id).getTime() > lastRead
  ).length;
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
    ><Icon icon={chat} height="1.5rem" style="vertical-align: -0.25rem" /> {$currentGameId}</ModalHeader
  >
  <div class="chat-messages modal-body" bind:this={messagesContainer}>
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
        <span class="mx-4" />
      </div>
    {/each}
    <span style="height: 0">&nbsp;</span>
  </div>
  <ModalFooter>
    <form on:submit|preventDefault={sendMessage} style="width: 100%">
      <InputGroup>
        <Input type="text" bind:value={currentMessage} />
        <Button type="submit" color="secondary" outline>Send</Button>
      </InputGroup>
    </form>
  </ModalFooter>
</Modal>

<Button
  color="primary"
  on:click={toggle}
  class={"rounded-circle b-avatar sidebar-fab chat-button" + ($sidebarOpen ? " sidebar-open" : "")}
>
  <Icon icon={chat} style="height: 1.5rem; width: 1.5rem;" class="absolute-center" />
  {#if unreadMessages}
    <Badge pill color="danger">{unreadMessages}</Badge>
  {/if}
</Button>

<style lang="postcss" global>
  .modal {
    pointer-events: none;
  }

  .chat-messages {
    display: flex;
    flex-direction: column;
    font-family: Helvetica Neue, Helvetica, Arial, sans-serif;
    max-height: calc(100vh - 300px);
    overflow-y: auto;

    .message-container {
      display: flex;
      flex-direction: row;
      &:not(:last-of-type) {
        margin-bottom: 0.75em;
      }
      &:last-of-type {
        margin-bottom: -0.5em;
      }

      &.sent {
        flex-direction: row-reverse;
      }
      align-items: center;

      .message {
        color: rgb(34, 34, 34);
        background-color: rgb(234, 234, 234);
        border-radius: 6px;
        padding: 8px 20px;
        margin-right: auto;
        white-space: pre-wrap;
        line-height: 1.2;
        font-size: 14px;
        margin-left: 1em;

        display: grid; /* To remove the space below the <p> */

        &.system {
          align-self: center;
          font-weight: 300;
          font-size: 12px;
          font-style: italic;
          opacity: 0.55;
          margin-left: auto;
        }

        .message-meta {
          font-size: xx-small;
          margin-bottom: 0;
          margin-top: 5px;
          opacity: 0.5;
        }
      }

      &.sent .message {
        margin-left: auto;
        margin-right: 1em;
        color: white;
        background-color: rgb(78, 140, 255);
      }
    }
  }

  .chat-modal {
    position: absolute !important;
    bottom: 50px;

    right: calc(var(--fab-right) + 4em);
    transition: all 0.3s ease;

    &.sidebar-open {
      right: calc(var(--fab-right) + var(--sidebar-width));
    }
  }

  .sidebar-fab.chat-button {
    right: calc(var(--fab-right) + 4em);
    transition: all 0.3s ease;

    &.sidebar-open {
      right: calc(var(--fab-right) + var(--sidebar-width));
    }

    .badge {
      position: absolute;
      bottom: -3px;
      top: auto;
      right: -6px;
      padding: 0.3em 0.5em;
    }
  }

  @media screen and (max-width: 600px) {
    .chat-modal {
      bottom: 70px;

      right: auto;
      left: auto;
      transition: all 0.3s ease;

      &.sidebar-open {
        right: auto;
      }
    }

    .sidebar-fab.chat-button.sidebar-open {
      right: calc(var(--fab-right) + 4em);
    }
  }
</style>
