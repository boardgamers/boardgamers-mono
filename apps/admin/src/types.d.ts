import { IUser } from "@bgs/models";
import { ViteSSGContext } from "vite-ssg";

export type UserModule = (ctx: ViteSSGContext) => void;
export interface User extends IUser {
  _id: string;
}

export { GameInfo, Page } from "@bgs/models";

// export interface Game extends IAbstractGame {
//   _id: string;
// }
