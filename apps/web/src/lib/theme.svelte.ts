import { browser } from "$app/environment";

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

let currentTheme: Theme = getStoredTheme();

// Apply on init
applyTheme(currentTheme);

// Listen for system preference changes when in "system" mode
if (browser) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme === "system") {
      applyTheme("system");
    }
  });
}

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme) {
  currentTheme = theme;
  if (browser) {
    if (theme === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", theme);
    }
  }
  applyTheme(theme);
}

export function isDark(): boolean {
  return currentTheme === "dark" || (currentTheme === "system" && getSystemPreference());
}
