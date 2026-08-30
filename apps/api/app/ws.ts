import { keyBy, sortBy, uniqBy } from "@bgs/utils/array";
import { setTimeout as sleep } from "node:timers/promises";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import cache from "node-cache";
import WebSocket, { WebSocketServer } from "ws";
import "./config/db.ts";
import env from "./config/env.ts";
import type { Closable } from "@bgs/utils/log";
import type { GameDoc } from "@bgs/models";
import { colls } from "./config/db.ts";
import { accessTokenPayloadSchema, findGamesWithPlayersTurn } from "./models/index.ts";
import { chatReactionAggregates } from "./services/chatreaction.ts";

export const wss = new WebSocketServer({ port: env.listen.port.ws, host: env.listen.host });

type AugmentedWebSocket = WebSocket & {
	game?: string;
	room?: string;
	user?: ObjectId | null;
	gameUpdate?: Date;
	isAlive?: boolean;
};

function clients(): AugmentedWebSocket[] {
	return [...wss.clients].filter((ws) => ws.readyState === WebSocket.OPEN);
}

function catchError<Args extends unknown[]>(
	target: (...args: Args) => unknown,
	callback?: () => unknown,
): (...args: Args) => Promise<unknown> {
	return async (...args: Args) => {
		try {
			return await target(...args);
		} catch (err) {
			console.error(err);
		} finally {
			callback?.();
		}
	};
}

wss.on("listening", () => console.log("Listening for chat messages on port", env.listen.port.ws));
wss.on("error", (err) => console.error(err));

wss.on("connection", (ws: AugmentedWebSocket) => {
	console.log("new websocket connected");

	ws.isAlive = true;
	ws.on("pong", () => {
		ws.isAlive = true;
		if (ws.user) {
			updateActivity(ws.user, false).catch(console.error);
		}
	});

	ws.on(
		"message",
		catchError(async (message: WebSocket.RawData) => {
			// oxlint-disable-next-line typescript/no-base-to-string
			const data = JSON.parse(String(message));

			if ("room" in data) {
				ws.room = data.room;

				const roomMessages = await colls.chatMessages
					.find({ room: data.room })
					.sort({ _id: -1 })
					.limit(100)
					.project({ _id: 1, author: 1, data: 1, type: 1, editedAt: 1 })
					.toArray();

				if (ws.readyState !== ws.OPEN) {
					return;
				}

				ws.send(
					JSON.stringify({
						room: data.room,
						command: "messageList",
						messages: roomMessages.toReversed(),
					}),
				);

				// Existing reactions of the listed messages (#438) — only non-empty
				// aggregates, the client starts from a blank slate per room.
				const reactions = (await chatReactionAggregates(roomMessages.map((msg) => msg._id))).filter(
					(aggregate) => aggregate.reactions.length > 0,
				);
				if (reactions.length > 0 && ws.readyState === ws.OPEN) {
					ws.send(JSON.stringify({ room: data.room, command: "chat:reactions", updates: reactions }));
				}
			}
			if ("game" in data) {
				ws.game = data.game;
				ws.gameUpdate = undefined;
			}
			if ("fetchPlayerStatus" in data && ws.game && gameCache.get(ws.game)) {
				const game = gameCache.get<GameDoc>(ws.game);
				if (!game) {
					return;
				}
				const userDocs = await colls.users
					.find({ _id: { $in: game.players.map((x) => x._id) } })
					.project({ "security.lastActive": 1, "security.lastOnline": 1 })
					.toArray();

				if (ws.readyState !== ws.OPEN) {
					return;
				}

				// Send [{_id: player1, status: "online"}, {_id: player2, status: "offline"}, {_id: player3, status: "away"}]
				ws.send(
					JSON.stringify({
						command: "game:playerStatus",
						players: userDocs.map((user) => ({
							_id: user._id,
							status:
								Date.now() - (user.security.lastOnline ?? new Date(0)).getTime() < 60 * 1000
									? "online"
									: Date.now() - (user.security.lastActive ?? new Date(0)).getTime() < 60 * 1000
										? "away"
										: "offline",
						})),
					}),
				);
			}
			if ("jwt" in data) {
				try {
					const decoded = accessTokenPayloadSchema.parse(jwt.verify(data.jwt, env.jwt.keys.public));

					ws.user = new ObjectId(decoded.userId);
					updateActivity(ws.user, true).catch(console.error);
					sendActiveGames(ws);
				} catch {
					ws.user = null;
				}
			}
			// Application-level ping: lets the client detect a silently-dead connection (a proxy
			// or mobile OS that dropped the socket without a close frame) and force a reconnect.
			if (data.ping && ws.readyState === ws.OPEN) {
				ws.send(JSON.stringify({ command: "pong" }));
			}
			if (data.online && ws.user) {
				updateActivity(ws.user, true).catch(console.error);
			}
		}),
	);

	ws.on("close", () => {
		console.log("websocket closed");
	});

	ws.on("error", () => {
		console.log("websocket error");
	});
});

// Check if sockets are alive, close them otherwise
const pingInterval = setInterval(function ping() {
	for (const ws of clients()) {
		if (!ws.isAlive) {
			ws.terminate();
		}

		ws.isAlive = false;
		ws.ping(() => {});

		sendActiveGames(ws);
	}
}, 20000);

function sendActiveGames(ws: AugmentedWebSocket) {
	if (ws.user) {
		findGamesWithPlayersTurn(ws.user)
			.project({ _id: 1 })
			.toArray()
			.then((gamesList) => {
				ws.send(JSON.stringify({ command: "games:currentTurn", games: gamesList.map((game) => game._id) }));
			})
			.catch(console.error);
	}
}

let lastChecked = ObjectId.createFromTime(Math.floor(Date.now() / 1000));
let lastEditChecked = new Date();
let lastReactionChecked = new Date();

const gameCache = new cache({ stdTTL: 24 * 3600 });

/**
 * Check periodically for new messages in db and send them to clients
 */
let stopped = false;

// Test hook: stops the poll loop before the shared test db closes, so the loop's
// error path (which exits the process) can't race the runner's teardown.
export function stopWs() {
	stopped = true;
	clearInterval(pingInterval);
	wss.close();
	for (const ws of wss.clients) {
		ws.terminate();
	}
}

/**
 * Graceful-shutdown closable for PM2 reload (registered in server.ts). ws's
 * WebSocketServer.close() never closes existing client sockets — its callback only
 * fires once every client is gone — so registering the raw wss would stall every
 * reload with connected chat clients until gracefulShutdown's force-cap, and the
 * sockets would then die abruptly at process.exit (no close frame). Instead close
 * each client with 1001 "going away": browsers fire onclose immediately and the web
 * client reconnects ~2s later (apps/web/src/lib/websocket.svelte.ts) to a live
 * worker. Clients that never ack the close frame get terminated after a short grace
 * so the drain still finishes well under PM2's kill_timeout.
 */
export const wsShutdown: Closable = {
	close(cb) {
		stopped = true;
		clearInterval(pingInterval);
		for (const ws of wss.clients) {
			ws.close(1001, "server restarting");
		}
		const stragglers = setTimeout(() => {
			for (const ws of wss.clients) {
				ws.terminate();
			}
		}, 2000);
		stragglers.unref();
		wss.close(() => {
			clearTimeout(stragglers);
			cb?.();
		});
	},
};

async function run() {
	// oxlint-disable-next-line no-unmodified-loop-condition -- flipped by stopWs() (test hook)
	while (!stopped) {
		// Find new messages
		const messages = await colls.chatMessages.find({ _id: { $gt: lastChecked } }).toArray();
		const messagesPerRooms = Object.groupBy(messages, (msg) => msg.room.toString());

		// Strip the `room` field from messages before sending them to clients
		const sanitizedPerRoom = new Map<string, Omit<(typeof messages)[number], "room">[]>();
		for (const [room, msgs] of Object.entries(messagesPerRooms)) {
			sanitizedPerRoom.set(
				room,
				(msgs ?? []).map(({ room: _room, ...rest }) => rest),
			);
		}

		for (const ws of clients()) {
			if (ws.room && sanitizedPerRoom.has(ws.room)) {
				ws.send(
					JSON.stringify({
						room: ws.room,
						messages: sanitizedPerRoom.get(ws.room),
						command: "newMessages",
					}),
				);
			}
		}

		if (messages.length > 0) {
			lastChecked = messages[messages.length - 1]._id;
		}

		// Edited messages keep their _id, so the poll above never sees them — track them by
		// editedAt (partial index, see @bgs/models) and re-send so open clients refresh in place.
		const editedMessages = await colls.chatMessages.find({ editedAt: { $gt: lastEditChecked } }).toArray();

		if (editedMessages.length > 0) {
			const editedPerRoom = Object.groupBy(editedMessages, (msg) => msg.room.toString());

			for (const ws of clients()) {
				const edited = ws.room && editedPerRoom[ws.room];
				if (edited) {
					ws.send(
						JSON.stringify({
							room: ws.room,
							messages: edited.map(({ room: _room, ...rest }) => rest),
							command: "updatedMessages",
						}),
					);
				}
			}

			lastEditChecked = new Date(Math.max(...editedMessages.map((msg) => msg.editedAt!.getTime())));
		}

		// Reaction changes (#438): set/unset both bump `updatedAt` (unset flips
		// `active` instead of deleting precisely so this watermark sees it), so one
		// indexed poll catches every change. Push the touched messages' FULL
		// current aggregates — idempotent for clients, no add/remove deltas.
		const touched = await colls.chatReactions
			.find({ updatedAt: { $gt: lastReactionChecked } })
			.project<{ room: string; message: ObjectId; updatedAt?: Date }>({ room: 1, message: 1, updatedAt: 1 })
			.toArray();

		if (touched.length > 0) {
			lastReactionChecked = new Date(Math.max(...touched.map((doc) => doc.updatedAt?.getTime() ?? 0)));

			const openRooms = new Set(clients().map((ws) => ws.room));
			const perRoom = new Map<string, Map<string, ObjectId>>();
			for (const doc of touched) {
				if (!openRooms.has(doc.room)) {
					continue;
				}
				const forRoom = perRoom.get(doc.room) ?? new Map<string, ObjectId>();
				forRoom.set(doc.message.toHexString(), doc.message);
				perRoom.set(doc.room, forRoom);
			}

			for (const [room, messageIds] of perRoom) {
				const updates = await chatReactionAggregates([...messageIds.values()]);
				const payload = JSON.stringify({ room, command: "chat:reactions", updates });
				for (const ws of clients()) {
					if (ws.room === room) {
						ws.send(payload);
					}
				}
			}
		}

		const gameConditions = uniqBy(
			sortBy([...clients()], (c) => String(c.gameUpdate ?? "")),
			(c) => c.game,
		).map((x) => ({
			_id: x.game,
			updatedAt: { $gt: x.gameUpdate ?? new Date(0) },
		}));

		if (gameConditions.length > 0) {
			const gamesList = await colls.games
				.find({ $or: gameConditions })
				.project({ updatedAt: 1, "players._id": 1 })
				.toArray();

			for (const game of gamesList) {
				gameCache.set(game._id, game);
			}

			if (gamesList.length > 0) {
				const playerIds = (
					await colls.games
						.aggregate([
							{ $match: { _id: { $in: gamesList.map((game) => game._id) } } },
							{ $project: { "players._id": 1 } },
							{ $unwind: "$players" },
							{ $group: { _id: "$players._id" } },
						])
						.toArray()
				).map((x) => x._id);
				const userDocs = await colls.users
					.find({ _id: { $in: playerIds } })
					.project({ "security.lastActive": 1, "security.lastOnline": 1 })
					.toArray();
				const usersById = keyBy<(typeof userDocs)[0]>(userDocs, (user) => user._id.toString());

				for (const ws of clients()) {
					if (ws.readyState !== WebSocket.OPEN) {
						continue;
					}

					if (ws.game) {
						const game = gameCache.get<GameDoc>(ws.game);
						const localUpdate = game?.updatedAt;
						if (game && localUpdate && (!ws.gameUpdate || ws.gameUpdate < localUpdate)) {
							ws.gameUpdate = localUpdate;

							ws.send(JSON.stringify({ command: "game:lastUpdate", lastUpdate: localUpdate, game: ws.game }));
							ws.send(
								JSON.stringify({
									command: "game:playerStatus",
									players: game.players
										.filter((pl) => pl._id.toString() in usersById)
										.map((pl) => usersById[pl._id.toString()])
										.map((user) => ({
											_id: user._id,
											status:
												Date.now() - (user.security.lastOnline ?? new Date(0)).getTime() < 60 * 1000
													? "online"
													: Date.now() - (user.security.lastActive ?? new Date(0)).getTime() < 60 * 1000
														? "away"
														: "offline",
										})),
								}),
							);
						}
					}
				}
			}
		}

		await sleep(250);
	}
}

run().catch((err: Error) => {
	console.error(err);
	process.exit(1);
});

async function updateActivity(user: ObjectId, online: boolean) {
	try {
		if (online) {
			await colls.users.updateOne(
				{ _id: user },
				{ $set: { "security.lastActive": new Date(), "security.lastOnline": new Date() } },
			);
		} else {
			await colls.users.updateOne({ _id: user }, { $set: { "security.lastActive": new Date() } });
		}
	} catch (err) {
		console.error(err);
	}
}
