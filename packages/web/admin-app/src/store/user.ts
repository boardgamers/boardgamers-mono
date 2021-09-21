import { IUser } from "@bgs/types/user";
import { defineStore } from "pinia";

export type Token = { code: string; expiresAt: number };

export const useUserStore = defineStore("user", () => {
  const user = ref<IUser>();
  const refreshToken = useStorage<Token | null>("refreshToken", { code: "", expiresAt: 0 });

  const accessTokens = reactive<Record<string, Token>>({});

  const logOut = () => {
    delete user.value;
    refreshToken.value = null;
  };

  const updateAuth = (payload: { user: IUser; accessToken: Token; refreshToken: Token }) => {
    user.value = payload.user;
    refreshToken.value = payload.refreshToken;
    accessTokens.all = payload.accessToken;
  };

  return { user, refreshToken, accessTokens, logOut, updateAuth };
});
