import mongoose from "mongoose";
import { ObjectId } from "bson";
import { IAbstractGame } from "@gaia-project/site-lib/game";
import schema from "@gaia-project/site-lib/dist/game";

export interface GameDocument extends IAbstractGame<ObjectId>, mongoose.Document {
  _id: string;
}

export interface GameModel extends mongoose.Model<GameDocument> {
  findWithPlayer(playerId: ObjectId): mongoose.DocumentQuery<GameDocument[], GameDocument>;
  findWithPlayersTurn(playerId: ObjectId): mongoose.DocumentQuery<GameDocument[], GameDocument>;
  findWithBoardgame(boardgame: string): mongoose.DocumentQuery<GameDocument[], GameDocument>;

  /** Basics projection */
  basics(): string[];
}

// For websocket server. To find whether games have updated
schema.index({ updatedAt: 1 });

schema.static("findWithPlayer", function (this: GameModel, playerId: ObjectId) {
  return this.find({ "players._id": playerId }).sort("-lastMove");
});

schema.static("findWithPlayersTurn", function (this: GameModel, playerId: ObjectId) {
  // The first condition is to leverage the index
  const conditions = { status: "active" as "active", "currentPlayers._id": playerId };
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

const Game = mongoose.model<GameDocument, GameModel>("Game", schema);
export default Game;
