import { browser } from "$app/environment";
import { initWebsocket } from "@/lib/websocket.svelte";

export function useWebsocket() {
  if (browser) {
    initWebsocket();
  }
}
