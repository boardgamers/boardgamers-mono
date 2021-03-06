import { IAbstractGame } from "@lib/game";
import makeSchema from "@lib/schemas/game";
import mongoose, { Types } from "mongoose";

const schema = makeSchema<GameDocument, GameModel>();
export interface GameDocument extends IAbstractGame<Types.ObjectId>, mongoose.Document {}

export interface GameModel extends mongoose.Model<GameDocument> {
  findWithPlayer(playerId: Types.ObjectId): mongoose.Query<GameDocument[], GameDocument>;
  findWithPlayersTurn(playerId: Types.ObjectId): mongoose.Query<GameDocument[], GameDocument>;
  findWithBoardgame(boardgame: string): mongoose.Query<GameDocument[], GameDocument>;

  /** Basics projection */
  basics(): string[];
}

// For websocket server. To find whether games have updated
schema.index({ updatedAt: 1 });

schema.static("findWithPlayer", function (this: GameModel, playerId: Types.ObjectId) {
  return this.find({ "players._id": playerId }).sort("-lastMove");
});

schema.static("findWithPlayersTurn", function (this: GameModel, playerId: Types.ObjectId) {
  // The first condition is to leverage the index
  const conditions = { status: "active", "currentPlayers._id": playerId } as const;
  return this.find(conditions).sort("-lastMove");
});

schema.static("findWithBoardgame", function (this: GameModel, boardgame: string) {
  return this.find({ "game.name": boardgame }).sort("-lastMove");
});

schema.static("basics", () => {
  return [
    "players",
    "currentPlayers",
    "options.setup.nbPlayers",
    "options.timing",
    "game.expansions",
    "game.name",
    "game.version",
    "status",
    "creator",
    "data.round",
    "lastMove",
  ];
});

schema.pre("validate", function (this: GameDocument) {
  if (!this.options.timing.timePerMove) {
    this.options.timing.timePerMove = 15 * 60;
  } else if (this.options.timing.timePerMove > 24 * 3600) {
    this.options.timing.timePerMove = 24 * 3600;
  }

  if (!this.options.timing.timePerGame) {
    this.options.timing.timePerGame = 15 * 24 * 3600;
  }
});

const Game = mongoose.model("Game", schema);
export { Game };
