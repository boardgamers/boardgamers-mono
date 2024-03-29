import { browser } from "$app/env";
import { handleError, skipOnce } from "@/utils";
import type { IUser } from "@bgs/types";
import { derived, writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccessTokens } from "./useAccessTokens";
import { useRefreshToken } from "./useRefreshToken";
import { useRest } from "./useRest";

export type AuthData = {
  user: IUser;
  accessToken: { code: string; expiresAt: number };
  refreshToken: { code: string; expiresAt: number };
};

export const useAccount = defineStore(() => {
  const { get, setAccessToken, post } = useRest();

  let loaded = false;

  const loadAccount = async (force = false) => {
    if (loaded && !force) {
      return;
    }
    return get<IUser | null>("/account").then(
      (val) => {
        loaded = true;
        account.set(val);
      },
      (err) => (err.status !== 404 ? handleError(err) : void 0)
    );
  };

  const account = writable<IUser | null>(null);
  const accountId = derived(account, ($account) => $account?._id || null);

  const { refreshToken } = useRefreshToken();
  const accessTokens = useAccessTokens();

  if (browser) {
    account.subscribe(
      skipOnce<[IUser | null]>((newVal) => {
        if (!newVal) {
          refreshToken.set(null);
          accessTokens.set({});
        }
      })
    );
  }

  function setAuthData(data: AuthData) {
    account.set(data.user);
    refreshToken.set(data.refreshToken);
    setAccessToken(data.accessToken);
  }

  function login(email: string, password: string) {
    return post<AuthData>("/account/login", { email, password }).then(setAuthData);
  }

  async function logout() {
    await post("/account/signout");

    account.set(null);
  }

  return {
    loadAccount,
    account,
    accountId,
    setAuthData,
    login,
    logout,
  };
});
