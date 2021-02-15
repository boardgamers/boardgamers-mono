import { IUser } from "@lib/user";
import { EventEmitter } from "events";
import Vue from "vue";
import store from "../store";
import { refreshTokenIfNeeded } from "./axios";

class WebsocketHandler extends EventEmitter {
  ws: WebSocket = null;

  set room(newRoom: string) {
    this._room = newRoom;
    this.sendRoom();
  }

  get room() {
    return this._room;
  }

  sendRoom() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ room: this.room }));
    }
  }

  set game(newGame: string) {
    this._game = newGame;
    this.sendGame();
  }

  get game() {
    return this._game;
  }

  sendGame() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ game: this.game }));
    }
  }

  set user(user: IUser) {
    this.sendUser();
  }

  async sendUser() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const token = await refreshTokenIfNeeded("site");

      this.ws.send(JSON.stringify({ jwt: token?.code }));
    }
  }

  constructor() {
    super();
    this.connect();
  }

  connect() {
    clearInterval(this._interval);
    const protocol = window.location.protocol.includes("https") ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws`;
    console.log("connecting to websocket", url);

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onclose = ws.onerror = () => {
      console.log("websocket closed");
      this.clearWs(ws);

      // Automatically reconnect
      setTimeout(() => this.connect(), 2000);
    };

    ws.onopen = () => {
      this.sendRoom();
      this.sendGame();
      this.sendUser();
    };

    ws.onmessage = (evt) => {
      const obj = JSON.parse(evt.data);

      if (obj.command === "messageList") {
        this.emit("chat:messageList", obj.messages);
      } else if (obj.command === "newMessages") {
        this.emit("chat:newMessages", obj.messages);
      } else if (obj.command === "game:lastUpdate" && obj.game === this.game) {
        this.emit("game:lastUpdate", obj.lastUpdate);
      } else if (obj.command === "game:playerStatus") {
        store.commit("playerStatus", obj.players);
      } else if (obj.command === "games:currentTurn") {
        store.commit("activeGames", obj.games);
      }
    };

    this._interval = setInterval(() => {
      if (!document.hidden) {
        this.ws.send(JSON.stringify({ online: true, fetchPlayerStatus: true }));
      }
    }, 30 * 1000);
  }

  clearWs(ws: WebSocket) {
    ws.onclose = ws.onerror = ws.onmessage = ws.onopen = undefined;
    ws.close();
    clearInterval(this._interval);
  }

  _room: string;
  _game: string;
  _interval: NodeJS.Timeout;
}

export default WebsocketHandler;

Object.defineProperty(Vue.prototype, "$ws", {
  value: new WebsocketHandler(),
});
