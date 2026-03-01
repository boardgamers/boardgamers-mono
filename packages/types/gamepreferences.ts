export interface GamePreferences<T = string> {
  _id: T;

  user: T;
  game: string;

  preferences?: {
    alternateUI?: boolean;
    [key: string]: any;
  };

  access: {
    /**
     * Does the player own the game?
     */
    ownership: boolean;
    /**
     * Latest version the player can access
     */
    maxVersion?: number;
  };

  elo?: {
    value: number;
    games: number;
  };
}
