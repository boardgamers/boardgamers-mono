<script lang="ts">
import { Modal, ModalHeader, Icon, ModalBody, ModalFooter, Input, InputGroup, InputGroupAddon, Button } from "@/modules/cdk";
import { chatMessages, currentGameId, sidebarOpen } from "@/store";
import { dateFromObjectId, dateTime } from "@/utils";
import { fly } from "svelte/transition";

let isOpen = false
let toggle = () => (isOpen = !isOpen)
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
  <ModalBody>
    <div class="chat-messages">
      {#each $chatMessages as message}
        {#if message.type === "system"}
          <div class="message system">
            {message.data.text}
            <p class="message-meta">
              {dateTime(dateFromObjectId(message._id))}
            </p>
          </div>
        {:else}
          <div class="message">
            {message.data.text}
          </div>
        {/if}
      {/each}
    </div>
  </ModalBody>
  <ModalFooter>
    <InputGroup>
      <Input type="text" />
      <InputGroupAddon addonType="append">
        <Button color="secondary" outline>Send</Button>
      </InputGroupAddon>
    </InputGroup>
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

    .message {
      color: rgb(34, 34, 34);
      background-color: rgb(234, 234, 234);
      display: grid; /* To remove the space below the <p> */
      &:not(:last-child) {
        margin-bottom: 12px;
      }

      &.system {
        align-self: center;
        padding: 8px 20px;
        border-radius: 6px;
        font-weight: 300;
        font-size: 12px;
        line-height: 1.2;
        white-space: pre-wrap;
        font-style: italic;
        opacity: 0.55;
      }

      .message-meta {
        font-size: xx-small;
        margin-bottom: 0;
        margin-top: 5px;
        opacity: 0.5;
        text-align: center;
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
