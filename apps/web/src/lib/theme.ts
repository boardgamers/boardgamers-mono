import { browser } from "$app/environment";
import { writable, type Writable } from "svelte/store";

export type Theme = "light" | "dark" | "system";

function getSystemPreference(): boolean {
  return browser && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getStoredTheme(): Theme {
  if (!browser) return "system";
  return (localStorage.getItem("theme") as Theme) ?? "system";
}

function applyTheme(theme: Theme) {
  if (!browser) return;
  const isDark = theme === "dark" || (theme === "system" && getSystemPreference());
  document.documentElement.classList.toggle("dark", isDark);
}

// Use a store so components can subscribe with $currentTheme
export const currentTheme: Writable<Theme> = writable(getStoredTheme());

// Apply on init
applyTheme(getStoredTheme());

// Keep the DOM in sync whenever the store changes
currentTheme.subscribe((theme) => {
  applyTheme(theme);
});

// Listen for system preference changes when in "system" mode
if (browser) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    let theme: Theme;
    currentTheme.subscribe((t) => (theme = t))();
    if (theme === "system") {
      applyTheme("system");
    }
  });
}

export function setTheme(theme: Theme) {
  if (browser) {
    if (theme === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", theme);
    }
  }
  currentTheme.set(theme);
}

export function cycleTheme() {
  let current: Theme;
  currentTheme.subscribe((t) => (current = t))();
  const order: Theme[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(current) + 1) % order.length];
  setTheme(next);
}
