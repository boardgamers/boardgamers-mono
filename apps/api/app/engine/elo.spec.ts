import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eloDiff } from "./elo.ts";

describe("eloDiff", () => {
  it("should let player win if the opponent dropped", () => {
    assert.ok(
      eloDiff({ elo: 105, score: 0, dropped: false, games: 105 }, { elo: 106, score: 10, dropped: true }, false, 2) >
        10
    );
  });

  it("should let the player lose if he dropped", () => {
    assert.ok(
      eloDiff({ elo: 130, score: 10, dropped: true, games: 105 }, { elo: 106, score: 0, dropped: false }, false, 2) < 0
    );
  });

  it("should return 0 if both players dropped", () => {
    assert.strictEqual(
      eloDiff({ elo: 130, score: 10, dropped: true, games: 105 }, { elo: 106, score: 0, dropped: true }, false, 2),
      0
    );
  });

  it("should return 0 if someone else dropped", () => {
    assert.strictEqual(
      eloDiff({ elo: 130, score: 10, dropped: false, games: 105 }, { elo: 106, score: 0, dropped: false }, true, 2),
      0
    );
  });
});
