import { browser } from "$app/env";
import { extractCookie } from "@/utils/extract-cookie";
import { get as $, writable, Writable } from "svelte/store";
import { useCached } from "./useCached";
import { useSession } from "./useSession";

export type Token = { code: string; expiresAt: number };

export function useRefreshToken(): Writable<Token | null> {
  const { set, cached } = useCached<"refreshToken", Writable<Token | null>>("refreshToken");

  if (cached) {
    return cached;
  }

  const session = useSession();

  const refreshToken = writable<Token | null>(
    session.refreshToken ||
      extractCookie("refreshToken", document.cookie) ||
      JSON.parse(localStorage.getItem("refreshToken") ?? "null")
  );

  if (browser) {
    refreshToken.subscribe((newVal) => {
      // todo : remove when no longer relevant
      if (newVal && typeof newVal.expiresAt === "string") {
        refreshToken.set({ ...newVal, expiresAt: new Date(newVal.expiresAt).getTime() });
        return;
      }

      if (newVal) {
        localStorage.removeItem("refreshToken"); // todo : remove when no longer relevant
        document.cookie = `refreshToken=${JSON.stringify(newVal)}; MaxAge=${
          (newVal.expiresAt - Date.now()) / 1000
        }; SameSite=Strict`;

        setTimeout(() => {
          const $refreshToken = $(refreshToken);
          if ($refreshToken && $refreshToken.expiresAt < Date.now()) {
            refreshToken.set(null);
          }
        }, Date.now() - newVal.expiresAt + 10);
      } else {
        document.cookie = `refreshToken=null; expires=${new Date(0).toUTCString()}; SameSite=Strict`;
      }
    });
  }

  return set(refreshToken);
}
