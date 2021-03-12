import type { IUser } from "@lib/user";
import { writable } from "svelte/store";

export const user = writable<IUser | null>(null);

export type Token = { code: string; expiresAt: number };

export const refreshToken = writable<Token | null>(
  localStorage.getItem("refreshToken") ? JSON.parse(localStorage.getItem("refreshToken")!) : null
);

refreshToken.subscribe((newVal) =>
  newVal ? localStorage.setItem("refreshToken", JSON.stringify(newVal)) : localStorage.removeItem("refreshToken")
);

export const accessToken = writable<Token | null>(null);
export const gamesAccessToken = writable<Token | null>(null);
export const accountLoaded = writable(false);
