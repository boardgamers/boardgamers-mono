export { setAccessToken, getAccessToken, clearTokens } from "@/lib/auth.svelte";
import { writable } from "svelte/store";
import type { Token } from "@/lib/auth.svelte";

// This is now just a client-side cache, no longer per-session.
export const accessTokens = writable<Record<string, Token>>({});
