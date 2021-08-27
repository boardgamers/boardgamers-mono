import { IAbstractUser } from "@shared/types/user";
// import {IAbstractGame} from '@shared/types/game';
import { AxiosInstance } from "axios";

export interface User extends IAbstractUser {
  _id: string;
}

export { GameInfo } from "@shared/types/gameinfo";
export { Page } from "@shared/types/page";

// export interface Game extends IAbstractGame {
//   _id: string;
// }

declare module "vue/types/vue" {
  interface Vue {
    $axios: AxiosInstance;
    $message: any;
  }
}
