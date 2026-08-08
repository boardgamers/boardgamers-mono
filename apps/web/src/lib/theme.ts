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
	document.documentElement.classList.toggle("dark", isDark(theme));
}

export function isDark(theme: Theme): boolean {
	return theme === "dark" || (theme === "system" && getSystemPreference());
}

// Use a store so components can subscribe with $currentTheme
export const currentTheme: Writable<Theme> = writable(getStoredTheme());

// Resolved dark boolean — updates both when the theme setting changes AND when the
// system preference flips while the setting is "system". Iframes (which can't read
// the host page's DOM class) must subscribe to this, not $currentTheme, or they go
// stale on a system flip.
export const isDarkMode: Writable<boolean> = writable(isDark(getStoredTheme()));

// Apply on init
applyTheme(getStoredTheme());

// Keep the DOM in sync whenever the store changes
currentTheme.subscribe((theme) => {
	applyTheme(theme);
	isDarkMode.set(isDark(theme));
});

// Listen for system preference changes when in "system" mode
if (browser) {
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		let theme: Theme = "system";
		currentTheme.subscribe((t) => (theme = t))();
		if (theme === "system") {
			applyTheme("system");
			isDarkMode.set(getSystemPreference());
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
	let current: Theme = "system";
	currentTheme.subscribe((t) => (current = t))();
	const order: Theme[] = ["system", "light", "dark"];
	const next = order[(order.indexOf(current) + 1) % order.length];
	setTheme(next);
}
