import { GamePreferences as IGamePreferences } from "@bgs/types/gamepreferences";
import mongoose, { Schema, Types } from "mongoose";

export interface GamePreferencesDocument extends mongoose.Document<Types.ObjectId>, IGamePreferences<Types.ObjectId> {
  _id: Types.ObjectId;
}

export interface GamePreferencesModel extends mongoose.Model<GamePreferencesDocument> {
  findWithPlayer(playerId: Types.ObjectId): mongoose.Query<GamePreferencesDocument[], GamePreferencesDocument>;

  eloProjection(): string[];
}

const schema = new mongoose.Schema<GamePreferencesDocument, GamePreferencesModel>({
  user: Schema.Types.ObjectId,
  game: String,
  preferences: {},
  access: {
    ownership: Boolean,
    maxVersion: Number,
  },
  elo: {
    value: Number,
    games: Number,
  },
});

schema.index({ user: 1, game: 1 }, { unique: true });

schema.index({ game: 1, "elo.value": -1 }, { partialFilterExpression: { "elo.value": { $gt: 0 } } });

schema.static("findWithPlayer", function (this: GamePreferencesModel, playerId: Types.ObjectId) {
  return this.find({ user: playerId }).sort("-game");
});

schema.static("eloProjection", () => {
  return ["game", "elo"];
});

const GamePreferences = mongoose.model<GamePreferencesDocument, GamePreferencesModel>("GamePreferences", schema);

export { GamePreferences };
