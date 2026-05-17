import type { UserDoc, GameDoc, PlayerInfo, GameNotificationDoc, GamePreferencesDoc } from "@bgs/models";
import { ObjectId } from "mongodb";
import type { OptionalId } from "mongodb";
import { makeDefaultUser } from "../models/user.ts";

let userCounter = 0;

type TestUserOverrides = {
  _id?: ObjectId;
  account?: Partial<UserDoc["account"]>;
  settings?: Partial<UserDoc["settings"]>;
  security?: Partial<UserDoc["security"]>;
  meta?: Partial<UserDoc["meta"]>;
  authority?: UserDoc["authority"];
  createdAt?: UserDoc["createdAt"];
  updatedAt?: UserDoc["updatedAt"];
};

export function testUser(overrides: TestUserOverrides = {}): OptionalId<UserDoc> {
  const n = ++userCounter;
  const base = makeDefaultUser({
    username: `user${n}`,
    email: `user${n}@test.com`,
    slug: `user${n}`,
    password: "",
    confirmKey: "",
    confirmed: true,
    newsletter: false,
  });
  // Deep-merge overrides: top-level spread first, then per-subobject spreads
  return {
    ...base,
    ...overrides,
    account: {
      ...base.account,
      ...overrides.account,
    },
    settings: {
      ...base.settings,
      ...overrides.settings,
    },
    security: {
      ...base.security,
      ...overrides.security,
    },
    meta: {
      ...base.meta,
      ...overrides.meta,
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
  overrides: Partial<Omit<GameDoc, "players" | "_id" | "game">> & { _id: string; players?: Partial<PlayerInfo>[] } & {
    game: { name: string; version: number; expansions?: string[]; options?: unknown };
  },
): GameDoc {
  const creatorId = overrides.creator ?? overrides.players?.[0]?._id ?? new ObjectId();
  const { game: gameOverride, players: _playersOverride, creator: _creatorOverride, ...restOverrides } = overrides;
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
    ...restOverrides,
    creator: creatorId,
    game: { ...gameOverride, expansions: gameOverride.expansions ?? [] },
    players: (overrides.players ?? []).map((p) => testPlayer({ _id: p._id ?? new ObjectId(), ...p })),
  };
}

export function testNotification(
  overrides: Partial<OptionalId<GameNotificationDoc>> & {
    kind: GameNotificationDoc["kind"];
    game: string;
    processed: boolean;
  },
): OptionalId<GameNotificationDoc> {
  return { ...overrides };
}

export function testGamePrefs(
  overrides: Partial<OptionalId<GamePreferencesDoc>> & { user: ObjectId; game: string },
): OptionalId<GamePreferencesDoc> {
  return {
    access: { ownership: false },
    ...overrides,
  };
}
