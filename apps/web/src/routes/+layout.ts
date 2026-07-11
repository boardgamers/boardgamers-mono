import { browser } from "$app/environment";
import { page } from "$app/stores";
import { get as $ } from "svelte/store";
import type { LayoutLoad } from "./$types";
import { account, activeGames, setAccount } from "@/lib/stores.svelte";
import { initTokens } from "@/lib/auth.svelte";
import { initWebsocket } from "@/lib/websocket.svelte";
import { setApiContext } from "@/lib/api";
import { initNProgress } from "@/lib/nprogress.svelte";

export const load: LayoutLoad = async ({ data }) => {
  // Initialize client-side token state from cookies on first load
  initTokens();

  // Set the API context to use global fetch (client-side)
  setApiContext({ fetch: globalThis.fetch });

  // Seed the account store from SSR data
  if (browser) {
    setAccount(data.user);
    activeGames.set(data.activeGames);

    // Keep stores in sync with $page.data on navigations
    page.subscribe(($page) => {
      if ($page.data.user !== undefined) {
        setAccount($page.data.user ?? null);
      }
      if ($page.data.activeGames !== undefined) {
        activeGames.set($page.data.activeGames);
      }
    });

    // Initialize websocket + progress bar once
    initWebsocket();
    initNProgress();
  }

  return {};
};
