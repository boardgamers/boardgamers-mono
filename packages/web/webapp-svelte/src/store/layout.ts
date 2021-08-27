import { skipOnce } from "@/utils";
import { writable } from "svelte/store";

export const sidebarOpen = writable(localStorage.getItem("showSidebar") === "1");
sidebarOpen.subscribe(skipOnce((val) => localStorage.setItem("showSidebar", val ? "1" : "0")));
