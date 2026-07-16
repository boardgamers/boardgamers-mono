import { browser } from "$app/environment";
import type { LayoutLoad } from "./$types";
import { activeGames, setAccount, sidebarOpen } from "@/lib/stores.svelte";
import { initTokens } from "@/lib/auth.svelte";
import { initWebsocket } from "@/lib/websocket.svelte";
import { setApiContext } from "@/lib/api";
import { initNProgress } from "@/lib/nprogress.svelte";
import "@/lib/theme";

export const load: LayoutLoad = async ({ data, fetch }) => {
  initTokens();

  // Use event.fetch for SSR (handles relative URLs + proxy rewriting).
  // On the client, this is the browser's native fetch.
  setApiContext((prev) => ({ ...prev, fetch }));

  // Sync sidebar open state from cookie on both SSR and client
  if (data?.sidebarOpen !== undefined) {
    sidebarOpen.set(data.sidebarOpen);
  }

  if (browser) {
    // Seed stores from the initial SSR data
    setAccount(data?.user ?? null);
    if (data?.activeGames) {
      activeGames.set(data.activeGames);
    }

    initWebsocket();
    initNProgress();
  }

  // Pass through the layout data so child pages can access it via `await parent()`
  return {
    user: data?.user ?? null,
    activeGames: data?.activeGames ?? [],
  };
};
