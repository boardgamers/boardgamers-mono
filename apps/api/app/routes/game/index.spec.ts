import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose, { Types } from "mongoose";
import env from "../../config/env.ts";
import { setup } from "../../config/test-setup.ts";
import { Game, GameInfo, GamePreferences, JwtRefreshToken, User } from "../../models/index.ts";

const baseURL = () => `http://localhost:${env.listen.port.api}`;

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${baseURL()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, data, ok: res.ok };
}

describe("Game API", () => {
  const userId = new Types.ObjectId();
  let authHeaders: Record<string, string> = {};

  before(async () => {
    await setup();

    await User.create({
      _id: userId,
      account: { username: "test", email: "test@test.com" },
      security: { confirmed: true },
    });
    await GameInfo.create({
      _id: {
        game: "test",
        version: 1,
      },
      label: "Test",
      viewer: {
        url: "//test.com/test",
        topLevelVariable: "test",
      },
      players: [2],

      meta: {
        public: true,
      },
    });
    const refresh = await JwtRefreshToken.create({ user: userId });
    const token = await refresh.createAccessToken(["all"], false);
    authHeaders = { Authorization: `Bearer ${token}` };
  });

  it("should not be able to create a game without ownership", async () => {
    const res = await api(
      "POST",
      "/api/game/new-game",
      {
        gameId: "test",
        game: { game: "test", version: 1 },
        timePerMove: 5000,
        timePerGame: 5000,
        players: 2,
        options: { join: true },
      },
      authHeaders
    );

    assert.strictEqual(res.ok, false);
    assert.ok((res.data as any)?.message.includes("own the game"));
  });

  it("should be able to create a game with ownership", async () => {
    await GamePreferences.create({
      user: userId,
      game: "test",
      access: {
        ownership: true,
      },
    });

    const res = await api(
      "POST",
      "/api/game/new-game",
      {
        gameId: "test",
        game: { game: "test", version: 1 },
        timePerMove: 5000,
        timePerGame: 5000,
        players: 2,
        options: { join: true },
      },
      authHeaders
    );

    assert.strictEqual(res.ok, true);
  });

  it("should not be able to create a game with the wrong number of players", async () => {
    const res = await api(
      "POST",
      "/api/game/new-game",
      {
        gameId: "test-fail",
        game: { game: "test", version: 1 },
        timePerMove: 5000,
        timePerGame: 5000,
        players: 3,
        options: { join: true },
      },
      authHeaders
    );

    assert.strictEqual(res.ok, false);
    assert.strictEqual((res.data as any)?.message, "Wrong number of players");
  });

  it("should be able to leave the game", async () => {
    const res = await api("POST", "/api/game/test/unjoin", {}, authHeaders);

    assert.strictEqual(res.ok, true);
    assert.strictEqual(await Game.countDocuments({ _id: "test" }), 0, "Game should be deleted after creator unjoins");
  });

  after(() => mongoose.connection.db.dropDatabase());
});
