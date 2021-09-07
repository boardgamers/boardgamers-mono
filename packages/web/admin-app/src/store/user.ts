import { IUser } from "@shared/types/user";
import { defineStore, Store } from "pinia";

export type Token = { code: string; expiresAt: number };

export const useUserStore = defineStore("user", () => {
  const user = ref<IUser>();
  const refreshToken = useStorage<Token | null>("refreshToken", { code: "", expiresAt: 0 });

  const accessTokens = reactive<Record<string, Token>>({});

  const logOut = function (this: Store) {
    this.$patch(() => {
      delete user.value;
      refreshToken.value = null;
    });
  };

  function updateAuth(this: Store, payload: { user: IUser; accessToken: Token; refreshToken: Token }) {
    this.$patch(() => {
      user.value = payload.user;
      refreshToken.value = payload.refreshToken;
      accessTokens.all = payload.accessToken;
    });
  }

  return { user, refreshToken, accessTokens, logOut, updateAuth };
});
