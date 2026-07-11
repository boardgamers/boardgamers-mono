import { browser } from "$app/environment";
import { page } from "$app/stores";
import type { LayoutLoad } from "./$types";
import { account, activeGames, setAccount } from "@/lib/stores.svelte";
import { initTokens } from "@/lib/auth.svelte";
import { initWebsocket } from "@/lib/websocket.svelte";
import { setApiContext } from "@/lib/api";
import { initNProgress } from "@/lib/nprogress.svelte";

export const load: LayoutLoad = async ({ data, fetch }) => {
  initTokens();

  // Keep the API context in sync with the current event's fetch.
  // On the server this is event.fetch (handles relative URLs + proxy rewriting).
  // On the client this is the browser's global fetch.
  // Preserve `ip` if already set by +layout.server.ts.
  setApiContext((prev) => ({ ...prev, fetch }));

  if (browser) {
    setAccount(data.user);
    activeGames.set(data.activeGames);

    page.subscribe(($page) => {
      if ($page.data.user !== undefined) {
        setAccount($page.data.user ?? null);
      }
      if ($page.data.activeGames !== undefined) {
        activeGames.set($page.data.activeGames);
      }
    });

    initWebsocket();
    initNProgress();
  }

  return {};
};
