import { eloDiff } from "./elo";

describe("eloDiff", () => {
  it("should let player win if the opponent dropped", () => {
    expect(
      eloDiff({ elo: 105, score: 0, dropped: false, games: 105 }, { elo: 106, score: 10, dropped: true }, false, 2)
    ).to.gt(10);
  });

  it("should let the player lose if he dropped", () => {
    expect(
      eloDiff({ elo: 130, score: 10, dropped: true, games: 105 }, { elo: 106, score: 0, dropped: false }, false, 2)
    ).to.lt(0);
  });

  it("should return 0 if both players dropped", () => {
    expect(
      eloDiff({ elo: 130, score: 10, dropped: true, games: 105 }, { elo: 106, score: 0, dropped: true }, false, 2)
    ).to.equal(0);
  });

  it("should return 0 if someone else dropped", () => {
    expect(
      eloDiff({ elo: 130, score: 10, dropped: false, games: 105 }, { elo: 106, score: 0, dropped: false }, true, 2)
    ).to.equal(0);
  });
});
