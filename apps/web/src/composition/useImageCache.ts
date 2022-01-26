import { writable } from "svelte/store";
import { defineStore } from "./defineStore";

export const useImageCache = defineStore(() => {
  const imageCache = writable(Date.now());

  return {
    imageCache,
  };
});
