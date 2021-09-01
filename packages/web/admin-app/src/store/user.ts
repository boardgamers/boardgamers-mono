import { IUser } from "@shared/types/user";
import { defineStore } from "pinia";
import { ref } from "vue-demi";

export const useUserStore = defineStore("user", () => {
  const user = ref<IUser>();

  const logOut = function (this: any, ...args: any[]) {
    console.log("log out", this, args);
  };

  return { user, logOut };
});
