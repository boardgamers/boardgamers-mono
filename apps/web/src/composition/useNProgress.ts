import { browser } from "$app/environment";
import { getStores } from "$app/stores";

export function initNProgress() {
  if (!browser) return;

  const { navigating } = getStores();

  import("nprogress").then((NProgress) => {
    NProgress.configure({ minimum: 0.16 });

    navigating.subscribe((val) => {
      if (val) {
        NProgress.start();
      } else {
        NProgress.done();
      }
    });
  });
}

// Backward compat: old code called useNProgress() which was a defineStore that ran once.
export function useNProgress() {
  initNProgress();
}
