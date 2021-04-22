<script lang="ts">
import { post } from "@/api";

import { Modal, ModalHeader, Icon, ModalBody, ModalFooter, Input, InputGroup, InputGroupAddon, Button } from "@/modules/cdk";
import type { GameContext } from "@/pages/Game.svelte";
import { chatMessages, currentGameId, sidebarOpen, user } from "@/store";
import { defer } from "lodash";
import { dateFromObjectId, dateTime } from "@/utils";
import type { PlayerInfo } from "@lib/game";
import { getContext } from "svelte";
import { fly } from "svelte/transition";
import { PlayerGameAvatar} from "./Game";

let isOpen = false
let toggle = () => {isOpen = !isOpen}
export let room: string;

let currentMessage = "";

const sendMessage = defer(async () => {
  const msg = currentMessage;
  currentMessage = "";

  // Mark message as delivered? by adding meta: 'Delivered'
  return post(`/game/${room}/chat`, msg)
})

const {game}: GameContext= getContext("game")

function onMessagesChanged() {
  setTimeout(() => {
    const messagesContainer = document.querySelector('.chat-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight
    }
  })
}

$: userId = $user?._id
$: players = ($game?.players??[]).reduce((obj, player) => ({...obj, [player._id]: player}), {} as Record<string, PlayerInfo>)
$: onMessagesChanged(), [$chatMessages, isOpen]

</script>

<Modal
  {isOpen}
  {toggle}
  backdrop={false}
  transitionType={fly}
  transitionOptions={{ y: -300 }}
  class={"chat-modal" + ($sidebarOpen ? " sidebar-open" : "")}
>
  <ModalHeader {toggle}><Icon name="chat" /> {$currentGameId}</ModalHeader>
  <ModalBody class="chat-messages">
    {#each $chatMessages as message}
      <div class="message-container" class:sent={message.author === userId}>
        {#if message.author && message.author in players}
          <PlayerGameAvatar player={players[message.author]} showVp={false} />
        {/if}
        <div
          class="message"
          class:system={message.type === "system"}
          title={"Sent at " + dateTime(dateFromObjectId(message._id))}
        >
          {message.data.text}
          {#if !message.data.author}
            <p class="message-meta">
              {dateTime(dateFromObjectId(message._id))}
            </p>
          {/if}
        </div>
        <span class="mx-4" />
      </div>
    {/each}
    <span style="height: 0">&nbsp;</span>
  </ModalBody>
  <ModalFooter>
    <form on:submit|preventDefault={sendMessage}>
      <InputGroup>
        <Input type="text" bind:value={currentMessage} />
        <InputGroupAddon addonType="append">
          <Button type="submit" color="secondary" outline>Send</Button>
        </InputGroupAddon>
      </InputGroup>
    </form>
  </ModalFooter>
</Modal>

<Button
  color="primary"
  on:click={toggle}
  class={"rounded-circle b-avatar sidebar-fab chat-button" + ($sidebarOpen ? " sidebar-open" : "")}
  ><Icon name="chat" /></Button
>

<style lang="postcss" global>
  .sidebar-fab.chat-button {
    &.sidebar-open {
      right: calc(var(--fab-right) + var(--sidebar-width));
    }
  }

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
      }
    }
  }

  .chat-modal {
    position: absolute;
    bottom: 50px;

    right: var(--fab-right);

    &.sidebar-open {
      right: calc(var(--fab-right) + var(--sidebar-width));
    }
  }
</style>