export interface PlayerInfo<T = string> {
  _id: T;
  remainingTime: number;
  score: number;
  dropped: boolean;
  // Not dropped but quit after someone else dropped
  quit: boolean;
  name: string;
  faction?: string;
  voteCancel?: boolean;
  ranking?: number;
  elo?: {
    initial?: number;
    delta?: number;
  };
}

export type PlayerOrder = "random" | "host" | "join";
export type GameStatus = "open" | "active" | "ended";

export interface IAbstractGame<T = string, Game = any, GameOptions = any> {
  /** Ids of the players in the website */
  players: PlayerInfo<T>[];
  creator: T;

  currentPlayers?: Array<{
    _id: T;
    timerStart: Date;
    deadline: Date;
  }>;

  /** Game data */
  data: Game;

  context: {
    round: number;
  };

  options: {
    setup: {
      seed: string;
      nbPlayers: number;
      playerOrder: PlayerOrder;
    };
    timing: {
      timePerGame: number;
      timePerMove: number;
      /* UTC-based time of play, by default all day, during which the timer is active, in seconds */
      timer: {
        // eg 3600 = start at 1 am
        start: number;
        // eg 3600*23 = end at 11 pm
        end: number;
      };
      // The game will be cancelled if the game isn't full at this time
      scheduledStart: Date;
    };
    meta: {
      unlisted: boolean;
      minimumKarma: number;
    };
  };

  game: {
    name: string; // e.g. "gaia-project"
    version: number; // e.g. 1
    expansions: string[]; // e.g. ["spaceships"]

    options: GameOptions;
  };

  status: GameStatus;
  ready: boolean;
  cancelled: boolean;

  updatedAt: Date;
  createdAt: Date;
  lastMove: Date;
}

export interface IGame extends IAbstractGame {
  _id: string;
}
