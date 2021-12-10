import { writable } from "svelte/store";
import { defineStore } from "./defineStore";

export const useLogoClicks = defineStore(() => {
  const logoClicks = writable(0);
  return {
    logoClicks,
    logoClick: () => logoClicks.update((val) => val + 1),
  };
});
