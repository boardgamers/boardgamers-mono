export function eloDiff(
  player: { elo: number; score: number; dropped: boolean; games: number },
  opponent: { elo: number; score: number; dropped: boolean },
  droppedGame: boolean,
  numPlayers: number
) {
  const prob = 1.0 / (1.0 + Math.pow(10, (opponent.elo - player.elo) / 400));
  let wlt = 0;

  if (player.dropped && opponent.dropped) {
    return 0;
  } else if (player.dropped) {
    wlt = 0;
  } else if (opponent.dropped) {
    wlt = 1;
  } else if (droppedGame) {
    return 0;
  } else if (player.score === opponent.score) {
    wlt = 0.5;
  } else if (player.score > opponent.score) {
    wlt = 1;
  }

  const k = player.games >= 20 ? 20 : player.games >= 10 ? 40 : 60;
  return ((k * 3) / (numPlayers + 1)) * (wlt - prob);
}
