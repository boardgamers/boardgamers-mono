export { setRefreshToken, getRefreshToken, type Token } from "@/lib/auth.svelte";

// Backward compat: old code used useRefreshToken().refreshToken as a store.
// The new system uses module-level functions, but we expose a readable store
// for components that still subscribe to it.
import { readable } from "svelte/store";
import { getRefreshToken } from "@/lib/auth.svelte";

export const refreshToken = readable(getRefreshToken());
