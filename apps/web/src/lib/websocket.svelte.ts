import { browser } from "$app/environment";
import { get as getStore } from "svelte/store";
import { mintToken } from "./api";
import { account, activeGames, chatMessages, currentGameId, lastGameUpdate, playerStatus, room } from "./stores.svelte";

let ws: WebSocket | null = null;
let interval: ReturnType<typeof setInterval>;
let initialized = false;

export function initWebsocket() {
	if (!browser || initialized) return;
	initialized = true;

	room.subscribe(sendRoom);
	currentGameId.subscribe(sendGame);

	let oldUserId: string | undefined;
	account.subscribe((user) => {
		if (user?._id === oldUserId) return;
		oldUserId = user?._id;
		sendUser();
	});

	connect();
}

function sendRoom() {
	if (browser && ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ room: getStore(room) }));
	}
}

function sendGame() {
	if (browser && ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ game: getStore(currentGameId) }));
	}
}

const protocol = browser && window.location.protocol.includes("https") ? "wss" : "ws";
const url = browser ? `${protocol}://${window.location.host}/ws` : "";

async function sendUser() {
	if (browser && ws?.readyState === WebSocket.OPEN) {
		// Mint a site-scoped token for websocket auth (cookie-authed; null when logged out)
		const token = await mintToken("site").catch(() => null);
		ws.send(JSON.stringify({ jwt: token?.code ?? null }));
	}
}

function connect() {
	if (!browser) return;
	clearInterval(interval);

	ws = new WebSocket(url);

	ws.onclose = ws.onerror = () => {
		if (ws) {
			clearWs();
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

		if (obj.command === "messageList") {
			chatMessages.set(obj.messages);
		} else if (obj.command === "newMessages") {
			chatMessages.update((msg) => [...msg, ...obj.messages]);
		} else if (obj.command === "game:lastUpdate" && obj.game === getStore(currentGameId)) {
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
