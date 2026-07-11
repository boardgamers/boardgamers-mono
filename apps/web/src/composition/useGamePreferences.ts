export {
  gamePreferences,
  addDefaults,
  updatePreference,
  loadGamePreferences,
  loadAllGamePreferences,
} from "@/lib/game-preferences.svelte";

import {
  gamePreferences,
  addDefaults,
  updatePreference,
  loadGamePreferences,
  loadAllGamePreferences,
} from "@/lib/game-preferences.svelte";

export function useGamePreferences() {
  return {
    gamePreferences,
    addDefaults,
    updatePreference,
    loadGamePreferences,
    loadAllGamePreferences,
  };
}
