// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. The websocket server is started by this spec on an ephemeral port
// (test-setup only starts the main API); ws.ts is imported dynamically so the port
// override is in place before its module-level `new WebSocketServer(...)` runs.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import WebSocket from "ws";
import { colls } from "./config/db.ts";
import env from "./config/env.ts";
import { setup } from "./config/test-setup.ts";

let stopWs: () => void;
let port: number;

function connect(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

type WsPayload = {
	command: string;
	room?: string;
	messages?: Array<{ _id?: string; data?: { text?: string }; editedAt?: string; room?: string }>;
};

// Collects every message a socket receives, so a test can both await a command
// and assert another command never arrived.
function record(ws: WebSocket): WsPayload[] {
	const received: WsPayload[] = [];
	ws.on("message", (raw) => {
		// oxlint-disable-next-line typescript/no-base-to-string
		const payload: WsPayload = JSON.parse(String(raw));
		received.push(payload);
	});
	return received;
}

async function waitFor(received: WsPayload[], command: string, timeoutMs = 5000): Promise<WsPayload> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const found = received.find((msg) => msg.command === command);
		if (found) {
			return found;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for "${command}" (got: ${received.map((msg) => msg.command).join(", ")})`);
}

describe("Websocket chat poller", () => {
	const room = "ws-poller-game";
	const otherRoom = "ws-poller-other-game";
	const sockets: WebSocket[] = [];

	before(async () => {
		await setup();
		env.listen.port.ws = 0;
		const wsModule = await import("./ws.ts");
		stopWs = wsModule.stopWs;
		// The ephemeral port is only known once the server is actually listening.
		await new Promise<void>((resolve, reject) => {
			if (wsModule.wss.address()) {
				return resolve();
			}
			wsModule.wss.once("listening", resolve);
			wsModule.wss.once("error", reject);
		});
		const address = wsModule.wss.address();
		assert.ok(address && typeof address === "object");
		port = address.port;
	});

	after(() => {
		stopWs?.();
	});

	it("broadcasts new messages, then re-broadcasts them on edit as updatedMessages", async () => {
		const ws = await connect();
		sockets.push(ws);
		const received = record(ws);
		ws.send(JSON.stringify({ room }));
		await waitFor(received, "messageList");

		const bystander = await connect();
		sockets.push(bystander);
		const bystanderReceived = record(bystander);
		bystander.send(JSON.stringify({ room: otherRoom }));
		await waitFor(bystanderReceived, "messageList");

		const messageId = new ObjectId();
		await colls.chatMessages.insertOne({
			_id: messageId,
			room,
			author: { _id: new ObjectId(), name: "poller" },
			data: { text: "hello" },
			type: "text",
		});

		const fresh = await waitFor(received, "newMessages");
		assert.strictEqual(fresh.room, room);
		assert.strictEqual(fresh.messages?.[0]?.data?.text, "hello");

		await colls.chatMessages.updateOne(
			{ _id: messageId },
			{ $set: { "data.text": "hello, edited", editedAt: new Date() } },
		);

		const updated = await waitFor(received, "updatedMessages");
		assert.strictEqual(updated.room, room);
		const message = updated.messages?.[0];
		assert.ok(message);
		assert.strictEqual(message._id, messageId.toString());
		assert.strictEqual(message.data?.text, "hello, edited");
		assert.ok(message.editedAt);
		assert.strictEqual("room" in message, false, "room must be stripped before sending");

		// Room isolation: the bystander in another room saw neither broadcast.
		assert.ok(!bystanderReceived.some((msg) => msg.command === "newMessages" || msg.command === "updatedMessages"));

		for (const socket of sockets) {
			socket.close();
		}
	});
});
