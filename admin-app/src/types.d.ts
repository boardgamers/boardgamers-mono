import { IAbstractUser } from "@lib/user";
// import {IAbstractGame} from '@lib/game';
import { AxiosInstance } from "axios";

export interface User extends IAbstractUser {
  _id: string;
}

export { GameInfo } from "@lib/gameinfo";
export { Page } from "@lib/page";

// export interface Game extends IAbstractGame {
//   _id: string;
// }

declare module "vue/types/vue" {
  interface Vue {
    $axios: AxiosInstance;
    $message: any;
  }
}
