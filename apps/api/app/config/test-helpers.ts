import type { UserDoc, GameDoc, PlayerInfo, GameNotificationDoc, GamePreferencesDoc } from "@bgs/models";
import { ObjectId } from "mongodb";
import type { OptionalId } from "mongodb";
import { defaultKarma } from "../models/user.ts";

let userCounter = 0;

export function testUser(overrides: Partial<OptionalId<UserDoc>> & { _id?: ObjectId } = {}): OptionalId<UserDoc> {
  const n = ++userCounter;
  return {
    ...overrides,
    account: {
      username: `user${n}`,
      email: `user${n}@test.com`,
      karma: defaultKarma,
      ...overrides.account,
    },
  };
}

export function testPlayer(overrides: Partial<PlayerInfo> & { _id: ObjectId }): PlayerInfo {
  return {
    remainingTime: 0,
    score: 0,
    dropped: false,
    quit: false,
    name: "",
    ...overrides,
  };
}

export function testGame(
  overrides: Partial<Omit<GameDoc, "players">> & { _id: string; players?: Partial<PlayerInfo>[] } & {
    game: { name: string; version: number; expansions?: string[]; options?: unknown };
  }
): OptionalId<GameDoc> {
  const creatorId = overrides.creator ?? overrides.players?.[0]?._id ?? new ObjectId();
  return {
    status: "open",
    ready: false,
    cancelled: false,
    data: null,
    context: { round: 0 },
    options: {
      setup: { seed: "test", nbPlayers: 2, playerOrder: "random" },
      timing: { timePerGame: 5000, timePerMove: 5000, timer: { start: 0, end: 86400 } },
      meta: { unlisted: false },
    },
    ...overrides,
    creator: creatorId,
    game: { expansions: [], ...overrides.game },
    players: (overrides.players ?? []).map((p) => testPlayer({ _id: new ObjectId(), ...p })),
  };
}

export function testNotification(
  overrides: Partial<OptionalId<GameNotificationDoc>> & {
    kind: GameNotificationDoc["kind"];
    game: string;
    processed: boolean;
  }
): OptionalId<GameNotificationDoc> {
  return { ...overrides };
}

export function testGamePrefs(
  overrides: Partial<OptionalId<GamePreferencesDoc>> & { user: ObjectId; game: string }
): OptionalId<GamePreferencesDoc> {
  return {
    access: { ownership: false },
    ...overrides,
  };
}
