/* eslint-disable */

// declare module 'sendmail';
import { GameDocument } from "./models/game";
import { GameInfoDocument } from "./models/gameinfo";
import { UserDocument } from "./models/user";

declare global {
  namespace Application {
    export interface DefaultState {
      // user?: User;
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
