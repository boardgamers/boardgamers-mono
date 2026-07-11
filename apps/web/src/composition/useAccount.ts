export {
  account,
  setAccount,
  activeGames,
  addActiveGame,
  removeActiveGame,
  currentGameId,
  lastGameUpdate,
  playerStatus,
  room,
  chatMessages,
  sidebarOpen,
  imageCache,
  logoClick,
  developerSettings,
} from "@/lib/stores.svelte";
export { loadAccount, login, logout, setAuthData, type AuthData } from "@/lib/account.svelte";

import { account } from "@/lib/stores.svelte";
import { loadAccount, login, logout, setAuthData } from "@/lib/account.svelte";
import { derived } from "svelte/store";

const accountId = derived(account, ($account) => $account?._id || null);

// Backward compat: components still call useAccount() to get the store handles
export function useAccount() {
  return {
    account,
    accountId,
    setAuthData,
    login,
    logout,
    loadAccount,
  };
}
