import { browser } from "$app/env";
import { getStores } from "$app/stores";
import { defineStore } from "./defineStore";

export const useNProgress = defineStore(async () => {
  if (!browser) {
    return;
  }

  const { navigating } = getStores();

  import("nprogress/nprogress.css");
  const NProgress = await import("nprogress");

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
