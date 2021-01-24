<template>
  <div id="chat-top-container">
    <div style="position: sticky; width: 100%; height: 100vh; top: 0; margin-bottom: -200px; pointer-events: none">
      <div style="position: relative; width: 100%; height: 100%; pointer-events: none">
        <beautiful-chat
          :title="room"
          :participants="participants"
          :onMessageWasSent="sendMessage"
          :messageList="messageList"
          :newMessagesCount="newMessagesCount"
          :isOpen="isChatOpen"
          :close="closeChat"
          :open="openChat"
          :colors="colors"
          :showEmoji="true"
          :alwaysScrollToBottom="true"
          :showFile="false"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError, handleInfo } from "@/utils";
import debounce from "lodash/debounce";

@Component<ChatRoom>({
  created(this: ChatRoom) {
    this.loadLastRead();

    const listenNewMessages = (newMessages: Message[]) => this.newMessages(newMessages);
    const listenReplaceMessages = (newMessages: Message[]) => this.replaceMessages(newMessages);

    this.$ws.on("chat:newMessages", listenNewMessages);
    this.$ws.on("chat:messageList", listenReplaceMessages);

    this.$once("hook:beforeDestroy", () => {
      this.$ws.off("chat:newMessages", listenNewMessages);
      this.$ws.off("chat:messageList", listenReplaceMessages);
    });

    this.$ws.room = this.room;
  },
  data() {
    return {
      colors: {
        header: {
          bg: "#4e8cff",
          text: "#ffffff",
        },
        launcher: {
          bg: "#4e8cff",
        },
        messageList: {
          bg: "#ffffff",
        },
        sentMessage: {
          bg: "#4e8cff",
          text: "#ffffff",
        },
        receivedMessage: {
          bg: "#eaeaea",
          text: "#222222",
        },
        userInput: {
          bg: "#f4f7f9",
          text: "#565867",
        },
      },
    };
  },
  beforeDestroy(this: ChatRoom) {
    // Notify $store of chat closure
    this.closeChat();
  },
  destroyed(this: ChatRoom) {
    delete this.$ws.room;
  },
})
export default class ChatRoom extends Vue {
  @Prop()
  room: string;

  @Prop()
  me: string;

  lastRead: Date = new Date(0);

  @Prop({ default: () => [] })
  participants: Array<{ id: string; name: string; imageUrl: string }>;

  get user() {
    return this.$store.state.user;
  }

  replaceMessages(messages: Message[]) {
    this.messageList = messages.map((msg) => this.transformedMessage(msg));
    this.updateNewMessages();
  }

  async loadLastRead() {
    const get = await this.$axios.get(`/game/${this.room}/chat/lastRead`).then((r) => r.data);
    this.lastRead = new Date(get);
    this.updateNewMessages();
  }

  updateLastRead(newVal: Date) {
    if (this.lastRead.getTime() >= newVal.getTime()) {
      return;
    }
    this.lastRead = newVal;
    this.updateNewMessages();

    this.updateLastReadDebounce();
  }

  postLastRead() {
    console.log(this.lastRead);
    this.$axios.post(`/game/${this.room}/chat/lastRead`, { lastRead: this.lastRead.getTime() });
  }
  updateLastReadDebounce = debounce(() => this.postLastRead(), 2000, { leading: true });

  newMessages(messages: Message[]) {
    // Only NEW messages
    messages = messages.filter((msg) => !this.messageList.some((otherMsg) => otherMsg._id === msg._id));
    messages = messages.map((msg) => this.transformedMessage(msg));

    // Limit the number of messages shown
    this.messageList = [...this.messageList, ...messages].slice(0, 200);

    this.updateNewMessages();
  }

  updateNewMessages() {
    if (this.isChatOpen) {
      this.newMessagesCount = 0;
      this.updateLastRead(new Date());
    } else {
      this.newMessagesCount = this.messageList.filter(
        (msg) => new Date(parseInt(msg._id.substring(0, 8), 16) * 1000) > this.lastRead
      ).length;
    }
  }

  transformedMessage(message: Message): Message {
    if (message.type === "system") {
      const date = new Date(parseInt(message._id.substring(0, 8), 16) * 1000);
      const cv = (number) => ("0" + number).substr(-2);
      message.data.meta = `${date.getFullYear()}-${cv(date.getMonth() + 1)}-${cv(date.getDate())} ${cv(
        date.getHours()
      )}:${cv(date.getMinutes())}`;
    }

    if (message.type === "emoji") {
      message.data.emoji = message.data.text;
    }

    if (message.author === this.me) {
      message.author = "me";
    }

    return message;
  }

  sendMessage(msg: Message) {
    if (msg.data.emoji) {
      msg.data.text = msg.data.emoji;
      delete msg.data.emoji;
    }

    this.$axios.post(`/game/${this.room}/chat`, msg).then(
      () => {}, // Mark message as delivered? by adding meta: 'Delivered'
      (err) => handleError(err)
    );
  }

  openChat() {
    if (this.isChatOpen) {
      return;
    }
    this.$store.commit("openChat");
    this.isChatOpen = true;
    this.updateLastRead(new Date());
  }

  closeChat() {
    if (!this.isChatOpen) {
      return;
    }
    this.$store.commit("closeChat");
    this.isChatOpen = false;
  }

  /*** Private variables ***/
  private isChatOpen: boolean = false;
  private newMessagesCount = 0;
  private messageList: Message[] = [];
}

interface Message {
  _id: string;
  type: "emoji" | "system" | "text";
  author: string;
  meta?: string;
  text: string;
  data?: {
    meta?: string;
    text: string;
    emoji?: string;
  };
}
</script>

<style lang="scss">
@import "../stylesheets/variables.scss";

#chat-top-container {
  position: absolute;
  width: 100%;
  height: calc(100% + #{$top-height});
  left: 0;
  top: -$top-height;
  pointer-events: none;
}

.sc-chat-window,
.sc-launcher {
  z-index: 3;
}

.sc-message-list {
  padding: 20px 0 !important;
}

.sc-message {
  a.chatLink {
    color: inherit !important;
  }
}

.sc-launcher,
.sc-closed-icon,
.sc-launcher::before {
  width: 45px !important;
  height: 45px !important;

  position: absolute !important;
}

.sc-launcher {
  // right: $fab-right + 55px !important;
  left: min(calc(100% - 60px), calc(100vw - #{$fab-right} - 105px));
  bottom: $fab-bottom !important;
  pointer-events: all;
}

.sc-chat-window {
  position: absolute !important;
  pointer-events: all;
}

.sc-closed-icon,
.sc-open-icon {
  right: 0 !important;
  bottom: 0 !important;
  position: absolute !important;
}

.sc-new-messsages-count {
  left: 30px !important;
}

.sc-open-icon {
  right: -8px !important;
  bottom: -7px !important;
}

@media screen and (max-width: 600px) {
  .sc-launcher,
  .sc-launcher::before,
  .sc-chat-window {
    position: fixed !important;
  }

  #chat-top-container {
    position: fixed;
    width: 100%;
    height: 100%;
    right: 0px;
    bottom: 0px !important;
    pointer-events: none;
  }
}
</style>
