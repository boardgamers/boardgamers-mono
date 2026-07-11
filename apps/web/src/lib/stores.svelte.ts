import { browser } from "$app/environment";
import type { ChatMessage, IUser } from "@bgs/models";
import { writable } from "svelte/store";

// --- Account (client-side cache, seeded from $page.data.user) ---

export const account = writable<IUser | null>(null);

export function setAccount(user: IUser | null) {
  account.set(user);
}

// --- Active games (loaded via +layout.server.ts, maintained by websocket) ---

export const activeGames = writable<string[]>([]);

export function addActiveGame(gameId: string) {
  let current = false;
  activeGames.subscribe((games) => {
    current = games.includes(gameId);
  })();
  if (!current) {
    activeGames.update((games) => [...games, gameId]);
  }
}

export function removeActiveGame(gameId: string) {
  activeGames.update((games) => games.filter((g) => g !== gameId));
}

// --- Current game (websocket-maintained, shared across game components) ---

export const currentGameId = writable<string | null>(null);
export const lastGameUpdate = writable<Date>(new Date(0));
export const playerStatus = writable<Array<{ _id: string; status: "online" | "offline" | "away" }>>([]);

if (browser) {
  currentGameId.subscribe(() => {
    lastGameUpdate.set(new Date(0));
    playerStatus.set([]);
  });
}

// --- Current room / chat (websocket-maintained) ---

export const room = writable<string | null>(null);
export const chatMessages = writable<ChatMessage[]>([]);

if (browser) {
  currentGameId.subscribe((val) => room.set(val));
  room.subscribe(() => chatMessages.set([]));
}

// --- Sidebar open (UI state, cookie-backed) ---

import { extractCookie } from "@/utils/extract-cookie";

export const sidebarOpen = writable<boolean>(
  browser ? (extractCookie("sidebarOpen", document.cookie) ?? false) : false
);

if (browser) {
  sidebarOpen.subscribe((val) => {
    document.cookie = `sidebarOpen=${JSON.stringify(val)}; Path=/; Max-Age=${365 * 10 * 24 * 3600}; SameSite=Lax; Secure`;
  });
}

// --- Image cache buster, logo clicks, developer settings (minor UI state) ---

export const imageCache = writable<number>(Date.now());

export const logoClicks = writable<number>(0);
export function logoClick(): void {
  logoClicks.update((n) => n + 1);
}

export type DevGameSettings = {
  viewerUrl: string;
};

export const developerSettings = writable<boolean>(
  browser && JSON.parse(localStorage.getItem("developerSettings") ?? "false")
);

export const devGameSettings = writable<Record<string, DevGameSettings>>(
  browser ? JSON.parse(localStorage.getItem("devGameSettings") ?? "{}") : {}
);

if (browser) {
  devGameSettings.subscribe((val) => localStorage.setItem("devGameSettings", JSON.stringify(val)));

  developerSettings.subscribe((newVal) => {
    if (newVal) {
      localStorage.setItem("developerSettings", JSON.stringify(newVal));
    } else {
      localStorage.removeItem("developerSettings");
    }
  });
}
