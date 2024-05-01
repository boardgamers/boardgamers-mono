import makeSchema from "@bgs/models/game";
import type { Game } from "@bgs/types";

const schema = makeSchema<GameDocument>();

const Game = mongoose.model("Game", schema);

export default Game;
