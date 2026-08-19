import { browser } from "$app/environment";
import { get as getStore } from "svelte/store";
import { mintToken } from "./api";
import { account, activeGames, chatMessages, currentGameId, lastGameUpdate, playerStatus, room } from "./stores.svelte";

let ws: WebSocket | null = null;
let interval: ReturnType<typeof setInterval>;
let initialized = false;
// Set when the server answers our application-level ping; cleared each time we send one.
// If it stays cleared the connection is silently dead (see below) and we force a reconnect.
let pongReceived = false;

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

	// Mobile browsers freeze background tabs and silently drop their websocket: no close
	// frame reaches the client, so `onclose` never fires and a naive reconnect loop never
	// triggers. When the tab comes back to the foreground (or the network recovers),
	// proactively reconnect if the socket isn't open — otherwise chat stays empty.
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) reconnectIfStale();
	});
	window.addEventListener("online", reconnectIfStale);
	window.addEventListener("focus", reconnectIfStale);

	connect();
}

function reconnectIfStale() {
	if (!browser) return;
	if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
		connect();
	} else if (ws.readyState === WebSocket.OPEN) {
		// The socket claims to be open but may be silently dead (no close frame). Probe it:
		// if the server doesn't answer, the next ping cycle (<=5s) reconnects.
		sendPing();
	}
}

function sendRoom() {
	const currentRoom = getStore(room);
	// Don't send a null room: on a fresh connect the layout hasn't set the room yet, and
	// the server would reply with an empty messageList that wipes already-loaded chat.
	if (browser && ws?.readyState === WebSocket.OPEN && currentRoom) {
		ws.send(JSON.stringify({ room: currentRoom }));
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

function sendPing() {
	if (browser && ws?.readyState === WebSocket.OPEN) {
		pongReceived = false;
		ws.send(JSON.stringify({ ping: true }));
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
		// Consider the fresh connection alive until the first ping cycle proves otherwise.
		pongReceived = true;
	};

	ws.onmessage = (evt) => {
		const obj = JSON.parse(evt.data);

		if (obj.command === "pong") {
			pongReceived = true;
		} else if (obj.command === "messageList") {
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
		if (document.hidden) return;

		// The previous ping went unanswered: the connection is silently dead (a proxy or
		// the OS dropped it without a close frame). Force a reconnect so chat reloads.
		if (!pongReceived && ws?.readyState === WebSocket.OPEN) {
			clearWs();
			connect();
			return;
		}

		sendPing();
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ online: true, fetchPlayerStatus: true }));
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
