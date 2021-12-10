import { browser } from "$app/env";
import { skipOnce } from "@/utils";
import { writable } from "svelte/store";
import { defineStore } from "./defineStore";

export const useSidebarOpen = defineStore(() => {
  const sidebarOpen = writable(browser ? localStorage.getItem("showSidebar") === "1" : false);

  if (browser) {
    sidebarOpen.subscribe(skipOnce((val) => localStorage.setItem("showSidebar", val ? "1" : "0")));
  }

  return sidebarOpen;
});
