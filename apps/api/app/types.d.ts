import type { GameDoc, GameInfoDoc, UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";

declare global {
  namespace Application {
    export interface DefaultState {
      user?: WithId<UserDoc>;
      game?: GameDoc;
      foundUser?: WithId<UserDoc>;
      foundBoardgame?: GameInfoDoc;
      ip: string;
      requestId: string;
    }
  }
}

// declare module "koa" {
//   interface Context {

//   }
// }
