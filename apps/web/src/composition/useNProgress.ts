import { browser } from "$app/env";
import { getStores } from "$app/stores";
import NProgress from "nprogress";
import "nprogress/nprogress.css";
import { defineStore } from "./defineStore";

export const useNProgress = defineStore(() => {
  if (!browser) {
    return;
  }

  const { navigating } = getStores();

  NProgress.configure({
    // Full list: https://github.com/rstacruz/nprogress#configuration
    minimum: 0.16,
  });

  navigating.subscribe((val) => {
    if (val) {
      NProgress.start();
    } else {
      NProgress.done();
    }
  });
});
