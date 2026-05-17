import { keyBy, sortBy, uniqBy } from "@bgs/utils/array";
import { setTimeout as sleep } from "node:timers/promises";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import cache from "node-cache";
import WebSocket, { Server } from "ws";
import "./config/db.ts";
import env from "./config/env.ts";
import type { GameDoc } from "@bgs/models";
import { colls } from "./config/db.ts";
import { findGamesWithPlayersTurn } from "./models/index.ts";

const wss = new Server({ port: env.listen.port.ws, host: env.listen.host });

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
      console.error(err as Error);
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
    catchError(async (message: WebSocket.Data) => {
      // oxlint-disable-next-line typescript/no-base-to-string -- WebSocket.Data is always stringifiable
      const data = JSON.parse(String(message));

      if ("room" in data) {
        ws.room = data.room;

        const roomMessages = await colls.chatMessages
          .find({ room: data.room })
          .sort({ _id: -1 })
          .limit(100)
          .project({ _id: 1, author: 1, data: 1, type: 1 })
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
          const decoded = jwt.verify(data.jwt, env.jwt.keys.public) as { userId: string; scopes: string[] };

          if (decoded) {
            ws.user = new ObjectId(decoded.userId);
            updateActivity(ws.user, true).catch(console.error);
            sendActiveGames(ws);
          } else {
            ws.user = null;
          }
        } catch {
          ws.user = null;
        }
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
setInterval(function ping() {
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

const gameCache = new cache({ stdTTL: 24 * 3600 });

/**
 * Check periodically for new messages in db and send them to clients
 */
async function run() {
  while (1) {
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
