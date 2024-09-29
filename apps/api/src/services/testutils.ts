import type { ObjectId } from "mongodb";
import { collections, db } from "../config/db";
import env from "../config/env";
import type { Game } from "@bgs/types";

export namespace TestUtils {
  export async function createGame(_id: string, playerIds: ObjectId[]): Promise<Game<ObjectId>> {
    const doc: Game<ObjectId> = {
      _id: "test",
      game: {
        name: "gaia-project",
        version: 0,
        expansions: [],
        options: {},
      },
      players: playerIds.map((id, i) => ({
        _id: id,
        dropped: false,
        remainingTime: 1000,
        quit: false,
        score: 0,
        name: `player${i + 1}`,
      })),
      creator: playerIds[0],
      cancelled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      data: {},
      options: {
        setup: {
          nbPlayers: playerIds.length,
          playerOrder: "join",
          seed: "test",
        },
        meta: {
          unlisted: false,
          minimumKarma: 0,
        },
        timing: {
          scheduledStart: new Date(),
          timePerGame: 1000,
          timePerMove: 1000,
          timer: {
            end: 1000,
            start: 0,
          },
        },
      },
      context: {
        round: 0,
      },
      lastMove: new Date(),
      ready: true,
      status: "active",
      currentPlayers: [{ _id: playerIds[0], timerStart: new Date(), deadline: new Date(Date.now() + 100_000) }],
    };

    await collections.games.insertOne(doc);

    return doc;
  }

  export async function deleteDocuments(): Promise<void> {
    if (!env.isTest) {
      throw new Error("Not in test mode");
    }
    for (const collection of await db.collections()) {
      await collection.deleteMany({});
    }
  }
}
