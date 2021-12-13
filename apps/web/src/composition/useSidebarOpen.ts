import { browser } from "$app/env";
import { extractCookie } from "@/utils/extract-cookie";
import { writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useSession } from "./useSession";

export const useSidebarOpen = defineStore(() => {
  const { session } = useSession();
  const sidebarOpen = writable(
    session.sidebarOpen != null
      ? session.sidebarOpen
      : browser
      ? extractCookie("sidebarOpen", document.cookie) || JSON.parse(localStorage.getItem("sidebarOpen") ?? "false")
      : false
  );

  if (browser) {
    sidebarOpen.subscribe((newVal) => {
      localStorage.removeItem("sidebarOpen"); // todo : remove when no longer relevant
      document.cookie = `sidebarOpen=${JSON.stringify(newVal)}; MaxAge=${365 * 10 * 24 * 3_600}; SameSite=Strict`;
    });
  }

  return { sidebarOpen };
});
