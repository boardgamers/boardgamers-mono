export interface ViewerInfo {
  // https://unpkg.com/@gaia-project/viewer@^4
  url: string;
  dependencies: {
    scripts: string[];
    stylesheets: string[];
  };
  // gaiaViewer, launch is window.gaiaViewer.launch
  topLevelVariable: string;
  /**
   * Set to true if you want the game iframe to be full width / full height (instead of resizing height based on content)
   */
  fullScreen: boolean;
  /**
   * Set to true if you implicitly trust the viewer. They will have access to your local storage!
   *
   * Can be useful when cross-site fingerprinting protections mess with the game. Or maybe we should find a way to display
   * a warning instead when we detect the lack of feature!
   */
  trusted: boolean;
  /**
   * Does the UI support replays?
   */
  replayable: boolean;
}

type GameInfoOption = {
  label: string;
  type: "checkbox" | "select";
  name: string;
  items:
    | [
        {
          name: string;
          label: string;
        }
      ]
    | null;
};
export interface GameInfo {
  _id: {
    game: string;
    version: number;
  };

  label: string;

  description: string;
  rules: string;

  viewer: ViewerInfo & { alternate?: ViewerInfo };
  engine: {
    package: {
      name: string;
      version: string;
    };
    entryPoint: string;
  };

  // [{label: "Do not fill planets with faction color", name: 'noFactionFill', type: 'checkbox'}]
  preferences: GameInfoOption[];

  // Player settings that affect the engine - like autocharge
  settings: Array<GameInfoOption & { faction?: string }>;

  // [{label: "Last player <i>rotates</i> sectors before faction selection", name: "advancedRules", type: 'checkbox'}]
  options: GameInfoOption[];

  // [2, 3, 4]
  players: number[];

  // ['spaceships']
  expansions: Array<{
    label: string;
    name: string;
  }>;

  meta: {
    public: boolean;
    needOwnership: boolean;
  };
}
