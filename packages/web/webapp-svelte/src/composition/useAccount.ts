import { browser } from "$app/env";
import { handleError, skipOnce } from "@/utils";
import type { IUser } from "@bgs/types";
import { Writable, writable } from "svelte/store";
import { useAccessTokens } from "./useAccessTokens";
import { useCached } from "./useCached";
import { useRefreshToken } from "./useRefreshToken";
import { useRest } from "./useRest";

type UseAccount = { waitForAccount: Promise<void>; account: Writable<IUser | null> };

export function useAccount(): UseAccount {
  const { cached, set } = useCached<"account", UseAccount>("account");

  if (cached) {
    return cached;
  }

  const { get } = useRest();

  const p = get<IUser | null>("/account").then((val) => account.set(val), handleError);

  const account = writable<IUser | null>(null);

  const refreshToken = useRefreshToken();
  const accessTokens = useAccessTokens();

  if (browser) {
    account.subscribe(
      skipOnce((newVal) => {
        if (!newVal) {
          refreshToken.set(null);
          accessTokens.set({});
        }
      })
    );
  }

  return set({
    waitForAccount: p,
    account,
  });
}
