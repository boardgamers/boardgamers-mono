export { get, post, apiFetch, setApiContext, getApiContext, type ApiContext } from "@/lib/api";
export { setAccessToken, getAccessToken } from "@/lib/auth.svelte";

import { get, post, apiFetch } from "@/lib/api";
import { setAccessToken, getAccessToken } from "@/lib/auth.svelte";

export function useRest() {
  return {
    get,
    post,
    fetch: apiFetch,
    apiFetch,
    getAccessToken,
    setAccessToken,
  };
}