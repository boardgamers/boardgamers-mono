import { activeGames, currentGameId, lastGameUpdate, playerStatus, user } from "@/store";
import { chatMessages, currentRoom } from "@/store/room";
import type { IUser } from "@bgs/types";
import { getAccessToken } from "./rest";

let ws: WebSocket | null = null;

let $gameId: string | null;
let $room: string | null;
let $user: IUser | null;

currentRoom.subscribe((room) => {
  $room = room;

  sendRoom();
});

currentGameId.subscribe((gameId) => {
  $gameId = gameId;

  sendGame();
});

user.subscribe((newUser) => {
  const oldUser = $user;
  $user = newUser;

  if (newUser?._id !== oldUser?._id) {
    sendUser();
  }
});

function sendRoom() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ room: $room }));
  }
}

function sendGame() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ game: $gameId }));
  }
}

const protocol = window.location.protocol.includes("https") ? "wss" : "ws";
const url = `${protocol}://${window.location.host}/ws`;

async function sendUser() {
  if (ws?.readyState === WebSocket.OPEN) {
    const token = await getAccessToken(url);

    ws.send(JSON.stringify({ jwt: token?.code ?? null }));
  }
}

let interval: any;

function connect() {
  clearInterval(interval);
  console.log("connecting to websocket", url);

  ws = new WebSocket(url);

  ws.onclose = ws.onerror = () => {
    console.log("websocket closed");
    if (ws) {
      clearWs();

      // Automatically reconnect
      setTimeout(() => connect(), 2000);
    }
  };

  ws.onopen = () => {
    sendRoom();
    sendGame();
    sendUser();
  };

  ws.onmessage = (evt) => {
    const obj = JSON.parse(evt.data);
    console.log("websocket message", obj);

    if (obj.command === "messageList") {
      chatMessages.set(obj.messages);
    } else if (obj.command === "newMessages") {
      chatMessages.update((msg) => [...msg, ...obj.messages]);
    } else if (obj.command === "game:lastUpdate" && obj.game === $gameId) {
      lastGameUpdate.set(new Date(obj.lastUpdate));
    } else if (obj.command === "game:playerStatus") {
      playerStatus.set(obj.players);
    } else if (obj.command === "games:currentTurn") {
      activeGames.set(obj.games);
    }
  };

  interval = setInterval(() => {
    if (!document.hidden) {
      ws?.send(JSON.stringify({ online: true, fetchPlayerStatus: true }));
    }
  }, 30 * 1000);
}

function clearWs() {
  if (ws) {
    ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
    ws.close();
    clearInterval(interval);
  }
}

connect();
