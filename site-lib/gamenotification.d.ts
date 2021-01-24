/**
 * When it's a player's turn, this is created in the database
 *
 * Then the site checks if it's worthy of an email notification
 */
export interface GameNotification<T = string> {
  game: string;
  user?: T;
  createAt?: Date;
  kind: "gameEnded" | "currentMove" | "gameStarted" | "playerDrop" | "playerQuit";
  processed: boolean;
}
