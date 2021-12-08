import { browser } from "$app/env";
import { get as $ } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccount } from "./useAccount";
import { useActiveGames } from "./useActiveGames";
import { useCurrentGame } from "./useCurrentGame";
import { useCurrentRoom } from "./useCurrentRoom";
import { useRest } from "./useRest";

export const useWebsocket = defineStore(() => {
  let ws: WebSocket | null = null;

  const { account } = useAccount();
  const { room, chatMessages } = useCurrentRoom();
  const { currentGameId, lastGameUpdate, playerStatus } = useCurrentGame();
  const { activeGames } = useActiveGames();
  const { getAccessToken } = useRest();

  room.subscribe(sendRoom);
  currentGameId.subscribe(sendGame);

  let oldUserId = $(account)?._id;

  account.subscribe((user) => {
    if (user?._id === oldUserId) {
      return;
    }
    oldUserId = user?._id;
    sendUser();
  });

  function sendRoom() {
    if (browser && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ room: $(room) }));
    }
  }

  function sendGame() {
    if (browser && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ game: $(currentGameId) }));
    }
  }

  const protocol = window.location.protocol.includes("https") ? "wss" : "ws";
  const url = `${protocol}://${window.location.host}/ws`;

  async function sendUser() {
    if (browser && ws?.readyState === WebSocket.OPEN) {
      const token = await getAccessToken(url);

      ws.send(JSON.stringify({ jwt: token?.code ?? null }));
    }
  }

  let interval: NodeJS.Timeout;

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
      } else if (obj.command === "game:lastUpdate" && obj.game === $(currentGameId)) {
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
});
