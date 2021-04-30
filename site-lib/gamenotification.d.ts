/**
 * playerDrop: a player was dropped
 * dropPlayer: request to drop a player by another player
 */
export type notificationKind = "gameEnded" | "currentMove" | "gameStarted" | "playerDrop" | "playerQuit" | "dropPlayer";
export interface GameNotification<T = string> {
  game: string;
  user?: T;
  createAt?: Date;
  kind: notificationKind;
  processed: boolean;
  meta?: Record<string, any>;
}
