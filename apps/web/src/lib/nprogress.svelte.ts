import { browser } from "$app/environment";
import { navigating } from "$app/state";

export function initNProgress() {
  if (!browser) return;

  import("nprogress").then((NProgress) => {
    NProgress.configure({ minimum: 0.16 });

    $effect(() => {
      if (navigating.current) {
        NProgress.start();
      } else {
        NProgress.done();
      }
    });
  });
}
