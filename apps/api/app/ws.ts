import delay from "delay";
import jwt from "jsonwebtoken";
import { groupBy, keyBy, sortBy, uniq, uniqBy } from "lodash";
import cache from "node-cache";
import WebSocket, { Server } from "ws";
import "./config/db";
import env from "./config/env";
import { ChatMessage, Game, GameDocument, User } from "./models";
import { ObjectId } from "mongodb";

const wss = new Server({ port: env.listen.port.ws, host: env.listen.host });

type AugmentedWebSocket = WebSocket & {
  game?: string;
  room?: string;
  user?: ObjectId;
  gameUpdate?: Date;
  isAlive?: boolean;
};

function clients(): AugmentedWebSocket[] {
  return [...wss.clients].filter((ws) => ws.readyState === WebSocket.OPEN);
}

function catchError(target: (...args: any[]) => any, callback?: () => unknown) {
  return async (...args: any[]) => {
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
    updateActivity(ws.user, false).catch(console.error);
  });

  ws.on(
    "message",
    catchError(async (message: WebSocket.Data) => {
      const data = JSON.parse(message.toString());

      if ("room" in data) {
        ws.room = data.room;

        // Show only last 100 messages
        const roomMessages = await ChatMessage.find({ room: data.room })
          .lean(true)
          // Migrate old schema where user contained the author id
          // todo: Remove once all the old chat messages expire
          .select({
            author: { $cond: [{ $eq: [{ $type: "$author" }, "objectId"] }, { _id: "$author", name: "-" }, "$author"] },
            _id: 1,
            data: 1,
            type: 1,
          })
          .sort("-_id")
          .limit(100);

        // todo: Remove once all the old chat messages expire
        const userIds = uniq(
          roomMessages.filter((msg) => msg.author?.name === "-").map((msg) => msg.author._id.toString())
        );
        if (userIds.length > 0) {
          const userNames = Object.fromEntries(
            (
              await User.find({ _id: { $in: userIds } })
                .select("account.username")
                .lean(true)
            ).map((user) => [user._id.toString(), user.account.username])
          );
          for (const message of roomMessages) {
            if (message.author?.name === "-") {
              message.author.name = userNames[message.author._id.toString()] || "-";
            }
          }
        }

        if (ws.readyState !== ws.OPEN) {
          return;
        }

        ws.send(
          JSON.stringify({
            room: data.room,
            command: "messageList",
            messages: roomMessages.reverse(),
          })
        );
      }
      if ("game" in data) {
        ws.game = data.game;
        ws.gameUpdate = null;
      }
      if ("fetchPlayerStatus" in data && ws.game && gameCache.get(ws.game)) {
        const game = gameCache.get<GameDocument>(ws.game);
        const users = await User.find(
          { _id: { $in: game.players.map((x) => x._id) } },
          "security.lastActive security.lastOnline",
          { lean: true }
        );

        if (ws.readyState !== ws.OPEN) {
          return;
        }

        // Send [{_id: player1, status: "online"}, {_id: player2, status: "offline"}, {_id: player3, status: "away"}]
        ws.send(
          JSON.stringify({
            command: "game:playerStatus",
            players: users.map((user) => ({
              _id: user._id,
              status:
                Date.now() - (user.security.lastOnline ?? new Date(0)).getTime() < 60 * 1000
                  ? "online"
                  : Date.now() - (user.security.lastActive ?? new Date(0)).getTime() < 60 * 1000
                    ? "away"
                    : "offline",
            })),
          })
        );
      }
      if ("jwt" in data) {
        try {
          const decoded = jwt.verify(data.jwt, env.jwt.keys.public) as { userId: string; scopes: string[] };

          if (decoded) {
            ws.user = new Types.ObjectId(decoded.userId);
            updateActivity(ws.user, true).catch(console.error);
            sendActiveGames(ws);
          } else {
            ws.user = null;
          }
        } catch (err) {
          ws.user = null;
        }
      }
      if (data.online && ws.user) {
        updateActivity(ws.user, true).catch(console.error);
      }
    })
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
    if (ws.isAlive === false) {
      ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(() => {});

    sendActiveGames(ws);
  }
}, 20000);

function sendActiveGames(ws: AugmentedWebSocket) {
  if (ws.user) {
    Game.findWithPlayersTurn(ws.user)
      .select("_id")
      .lean(true)
      .then((games) => {
        ws.send(JSON.stringify({ command: "games:currentTurn", games: games.map((game) => game._id) }));
      })
      .catch(console.error);
  }
}

let lastChecked = Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000));

const gameCache = new cache({ stdTTL: 24 * 3600 });

/**
 * Check periodically for new messages in db and send them to clients
 */
async function run() {
  while (1) {
    // Find new messages
    const messages = await ChatMessage.find()
      .where({ _id: { $gt: lastChecked } })
      .lean();
    const messagesPerRooms = groupBy(messages, (msg) => msg.room.toString());

    for (const msg of messages) {
      delete msg.room;
    }

    for (const ws of clients()) {
      if (ws.room in messagesPerRooms) {
        ws.send(
          JSON.stringify({
            room: ws.room,
            messages: messagesPerRooms[ws.room],
            command: "newMessages",
          })
        );
      }
    }

    if (messages.length > 0) {
      lastChecked = messages[messages.length - 1]._id;
    }

    const gameConditions = uniqBy(sortBy([...clients()], "gameUpdate"), "game").map((x) => ({
      _id: x.game,
      updatedAt: { $gt: x.gameUpdate ?? new Date(0) },
    }));

    if (gameConditions.length > 0) {
      const games = await Game.find({ $or: gameConditions }, "updatedAt players._id", { lean: true });

      for (const game of games) {
        gameCache.set(game._id, game);
      }

      if (games.length > 0) {
        const playerIds = (
          await Game.aggregate()
            .match({ _id: { $in: games.map((game) => game._id) } })
            .project({ "players._id": 1 })
            .unwind("players")
            .group({ _id: "$players._id" })
        ).map((x) => x._id);
        const users = await User.find({ _id: { $in: playerIds } }, "security.lastActive security.lastOnline", {
          lean: true,
        });
        const usersById = keyBy<(typeof users)[0]>(users, (user) => user._id.toString());

        for (const ws of clients()) {
          if (ws.readyState !== WebSocket.OPEN) {
            continue;
          }

          if (ws.game) {
            const game = gameCache.get<GameDocument>(ws.game);
            const localUpdate: Date = game?.updatedAt;
            if (localUpdate && (!ws.gameUpdate || ws.gameUpdate < localUpdate)) {
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
                })
              );
            }
          }
        }
      }
    }

    await delay(250);
  }
}

run().catch((err: Error) => {
  console.error(err);
  process.exit(1);
});

async function updateActivity(user: Types.ObjectId, online: boolean) {
  try {
    if (online) {
      await User.updateOne(
        { _id: user },
        { $set: { "security.lastActive": new Date(), "security.lastOnline": new Date() } }
      );
    } else {
      await User.updateOne({ _id: user }, { $set: { "security.lastActive": new Date() } });
    }
  } catch (err) {
    console.error(err);
  }
}
