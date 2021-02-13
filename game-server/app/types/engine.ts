/* eslint-disable @typescript-eslint/no-explicit-any */
export type GameData = any;

export interface Engine {
  init(players: number, expansions: string[], options: any, seed?: string): Promise<GameData>;

  // Returns the new data to send to player
  move(data: GameData, move: any, player: number): Promise<GameData>;

  // Did the game end?
  ended(data: GameData): boolean;

  // Scores for the various players, just give the same score for ties
  scores(data: GameData): number[];

  // Drops a player from the game
  dropPlayer(data: GameData, player: number): Promise<GameData>;

  // Get current player(s)
  currentPlayer(data: GameData): number[] | number | undefined;

  // Returns how many log items the data has
  logLength(data: GameData): number;

  // Return log info to pass to the viewer. It can have any structure you want,
  // though we recommend something like {log: items[], availableMoves: moves[]}
  // Note: the secrets should be stripped if necessary, the player receiving the data is options.player
  logSlice(data: GameData, options?: { player?: number; start?: number; end?: number }): any;

  // **************************************************************************************
  // ************************************** OPTIONAL **************************************
  // **************************************************************************************

  setPlayerMetaData(data: GameData, player: number, metaData: { name: string }): GameData;

  setPlayerSettings(data: GameData, player: number, settings: Record<string, unknown>): GameData;
  playerSettings(data: GameData, player: number): Record<string, unknown>;

  // Rankings for the players. Do it if the scores are not enough to determine the rankings,
  // for example if there is a way to differentiate ties between same scores, or if the
  // lowest score is the best
  rankings(data: GameData): number[];

  // Current round
  round(data: GameData): number | undefined;

  // Is the game cancelled?
  // Cancel if players drop too early in the game
  cancelled(data: GameData): boolean;

  // Not applicable to all games. Just return the player's name if not applicable
  // Return undefined if applicable but not defined for player
  // Used for thumbnails in game lists
  factions(data: GameData): string[];

  // Middleware to process data to be sent to a player, strip secrets if needed
  // In case of a spectator, the player is undefined
  stripSecret(data: GameData, player?: number): any;

  // Middleware to process data to be sent to the backend
  // Undefined = do not save anything (for example if a move was
  // made just to request a backend calculation)
  toSave(data: GameData): any | undefined;

  // Important system messages to show in chat
  // Another call on `ret.data` should not show the same messages
  messages(data: GameData): { messages: string[]; data: GameData };

  // Replays the game, after GameData was manually edited by an admin
  replay(data: GameData): GameData;
}
