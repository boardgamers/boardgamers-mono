/* eslint-disable */

import type { ObjectId } from "mongodb";
import type { Game } from "@bgs/types";
import type { GameDocument } from "./models/game";
import type { GameInfoDocument } from "./models/gameinfo";
import type { UserDocument } from "./models/user";

declare global {
  namespace Application {
    export interface DefaultState {
      user?: UserDocument;
      game?: Game<OjbectId> | null;
      foundUser?: UserDocument;
      foundBoardgame?: GameInfoDocument;
      ip: string;
    }
  }
}

// declare module "koa" {
//   interface Context {

//   }
// }
