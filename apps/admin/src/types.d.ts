import { IAbstractUser } from "@bgs/types";
import { ViteSSGContext } from "vite-ssg";

export type UserModule = (ctx: ViteSSGContext) => void;
export interface User extends IAbstractUser {
  _id: string;
}

export { GameInfo, Page } from "@bgs/types";

// export interface Game extends IAbstractGame {
//   _id: string;
// }
