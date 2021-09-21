import { IAbstractUser } from "@bgs/types/user";
import { ViteSSGContext } from "vite-ssg";

export type UserModule = (ctx: ViteSSGContext) => void;
export interface User extends IAbstractUser {
  _id: string;
}

export { GameInfo } from "@bgs/types/gameinfo";
export { Page } from "@bgs/types/page";

// export interface Game extends IAbstractGame {
//   _id: string;
// }
