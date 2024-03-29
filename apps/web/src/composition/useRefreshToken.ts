import { browser } from "$app/env";
import { extractCookie } from "@/utils/extract-cookie";
import { get as $, writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useSession } from "./useSession";

export type Token = { code: string; expiresAt: number };

export const useRefreshToken = defineStore(() => {
  const { session } = useSession();

  const refreshToken = writable<Token | null>(
    session.refreshToken
      ? session.refreshToken
      : browser
      ? extractCookie("refreshToken", document.cookie) || JSON.parse(localStorage.getItem("refreshToken") ?? "null")
      : null
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
        console.log(
          "setting cookie",
          `refreshToken=${JSON.stringify(newVal)}; Max-Age=${Math.floor(
            (newVal.expiresAt - Date.now()) / 1000
          )}; Path=/; SameSite=Lax; Secure`
        );
        document.cookie = `refreshToken=${JSON.stringify(newVal)}; Max-Age=${Math.floor(
          (newVal.expiresAt - Date.now()) / 1000
        )}; Path=/; SameSite=Lax; Secure`;

        setTimeout(() => {
          const $refreshToken = $(refreshToken);
          if ($refreshToken && $refreshToken.expiresAt < Date.now()) {
            refreshToken.set(null);
          }
        }, Date.now() - newVal.expiresAt + 10);
      } else {
        console.log(
          "setting cookie",
          `refreshToken=null; path=/; expires=${new Date(0).toUTCString()}; SameSite=Lax; Secure`
        );
        document.cookie = `refreshToken=null; path=/; expires=${new Date(0).toUTCString()}; SameSite=Lax; Secure`;
      }
    });
  }

  return { refreshToken };
});
