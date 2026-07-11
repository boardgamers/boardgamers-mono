// Re-export from $lib for backward compatibility with components still using @/composition imports.
// These will be removed once all components are migrated to import from $lib directly.

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
export { get, post, apiFetch, setApiContext, getApiContext } from "@/lib/api";
export { gameInfos, loadGameInfos, gameInfo, gameInfoKey, latestGameInfos, loadGameInfo } from "@/lib/game-info.svelte";
export { loadGames, type LoadGamesResult, type LoadGamesParams } from "@/lib/games.svelte";
export {
  gamePreferences,
  addDefaults,
  updatePreference,
  loadGamePreferences,
  loadAllGamePreferences,
} from "@/lib/game-preferences.svelte";
export { loadEloRankings, type EloRanking, type LoadEloRankingsResult } from "@/lib/elo-rankings.svelte";
export { loadGame, loadGamePlayers } from "@/lib/game.svelte";
export { initWebsocket } from "@/lib/websocket.svelte";
export { setRefreshToken, initTokens } from "@/lib/auth.svelte";
