import { getStores } from "$app/stores";
import type { Session } from "@/hooks";
import { get as $, writable } from "svelte/store";

export const loadSession = writable<Session | null>(null);

export function useSession(): Session {
  return $(loadSession) ?? ($(getStores().session) as Session);
}

export function patchSession(session: Session): void {
  (session as any).toJSON = function (this) {
    const clone = { ...this };

    delete clone.toJSON;
    delete clone.fetch;
    delete clone.stores;

    return clone;
  };
}
