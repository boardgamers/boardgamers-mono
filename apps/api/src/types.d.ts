/* eslint-disable */

import type { ObjectId } from "mongodb";
import type { Game, User, GameInfo } from "@bgs/types";

declare global {
  namespace Application {
    export interface DefaultState {
      user?: User<ObjectId> | null;
      game?: Game<OjbectId> | null;
      foundUser?: User<ObjectId> | null;
      foundBoardgame?: GameInfo | null;
      ip: string;
    }
  }
}

// declare module "koa" {
//   interface Context {

//   }
// }
