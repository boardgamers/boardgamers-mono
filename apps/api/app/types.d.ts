/* eslint-disable */

import { GameDocument } from "./models/game";
import { GameInfoDocument } from "./models/gameinfo";
import { UserDocument } from "./models/user";

declare global {
  namespace Application {
    export interface DefaultState {
      user?: UserDocument;
      game?: GameDocument;
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
