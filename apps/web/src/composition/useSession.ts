import { getStores } from "$app/stores";
import type { Session } from "@/hooks";
import { get as $, writable } from "svelte/store";

export const loadSession = writable<Session | null>(null);

type SessionData = { stores: Map<unknown, unknown>; fetch: typeof fetch };

export function useSession(): { session: Session; data: SessionData } {
  const session = $(loadSession) ?? ($(getStores().session) as Session);

  const data = sessionData.get(session);

  if (!data) {
    throw new Error("Call useLoad before calls to useSession");
  }

  return {
    session,
    data,
  };
}

export const sessionData = new WeakMap<Session, SessionData>();
