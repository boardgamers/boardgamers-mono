import type { GameInfoDoc, GameInfoOption, GameNotificationDoc, GameDoc, UserDoc } from "@bgs/models";
import type { OptionalId, WithId } from "mongodb";

type SeedGame = GameDoc & { _id: string };

/** Pick a sensible default for a configurable game option. */
function defaultOptionValue(option: GameInfoOption): unknown {
  if (option.default !== undefined) {
    return option.default;
  }
  if (option.type === "checkbox") {
    return false;
  }
  if (option.type === "select" && option.items?.length) {
    return option.items[0].name;
  }
  return undefined;
}

function defaultGameOptions(gameInfo: GameInfoDoc): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const option of gameInfo.options ?? []) {
    const value = defaultOptionValue(option);
    if (value !== undefined) {
      options[option.name] = value;
    }
  }
  return options;
}

/**
 * Build a ready-to-start game (status `open`, full roster, default options) for
 * the given game info and players, plus the `gameStarted` notification the
 * game-server cron consumes to initialize the engine (`data`/`context`) and flip
 * the game to `active`. The engine for `gameInfo` must be installed for that to
 * succeed.
 */
export function buildSeedGame(
  gameInfo: GameInfoDoc,
  users: WithId<UserDoc>[],
): { game: SeedGame; notification: OptionalId<GameNotificationDoc> } {
  const nbPlayers = gameInfo.players[0] ?? 2;
  const roster = users.slice(0, nbPlayers);
  if (roster.length < nbPlayers) {
    throw new Error(`Need ${nbPlayers} seeded users to start a ${gameInfo._id.game} game, got ${roster.length}`);
  }

  const gameId = `${gameInfo._id.game}-seed`;
  const now = new Date();

  const game: SeedGame = {
    _id: gameId,
    creator: roster[0]._id,
    players: roster.map((user) => ({
      _id: user._id,
      remainingTime: 15 * 60,
      score: 0,
      dropped: false,
      quit: false,
      name: user.account.username,
    })),
    currentPlayers: [],
    data: {},
    context: { round: 0 },
    options: {
      setup: { seed: gameId, nbPlayers, playerOrder: "random" },
      timing: { timePerGame: 15 * 60, timePerMove: 15 * 60 },
      meta: {},
    },
    game: {
      name: gameInfo._id.game,
      version: gameInfo._id.version,
      expansions: [],
      options: defaultGameOptions(gameInfo),
    },
    status: "open",
    ready: true,
    cancelled: false,
    createdAt: now,
    updatedAt: now,
    lastMove: now,
  };

  const notification: OptionalId<GameNotificationDoc> = {
    game: gameId,
    kind: "gameStarted",
    processed: false,
    createdAt: now,
    updatedAt: now,
  };

  return { game, notification };
}
