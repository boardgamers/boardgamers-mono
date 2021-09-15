import { IAbstractUser } from "@shared/types/user";
import { ViteSSGContext } from "vite-ssg";

export type UserModule = (ctx: ViteSSGContext) => void;
export interface User extends IAbstractUser {
  _id: string;
}

export { GameInfo } from "@shared/types/gameinfo";
export { Page } from "@shared/types/page";

// export interface Game extends IAbstractGame {
//   _id: string;
// }
