export { room, chatMessages } from "@/lib/stores.svelte";

import { room, chatMessages } from "@/lib/stores.svelte";

export function useCurrentRoom() {
  return { room, chatMessages };
}
