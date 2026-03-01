 


import type { GameDocument } from "./models/game.ts";
import type { GameInfoDocument } from "./models/gameinfo.ts";
import type { UserDocument } from "./models/user.ts";

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
