import { browser } from "$app/environment";
import { navigating } from "$app/state";

// Track navigation progress outside a component. `$effect` must be created during
// component init, so running it inside the dynamic-import callback would throw
// `effect_orphan`. `$effect.root` is the non-component equivalent — safe here.
let started = false;

export function initNProgress() {
	if (!browser || started) return;
	started = true;

	import("nprogress").then((NProgress) => {
		NProgress.configure({ minimum: 0.16 });

		$effect.root(() => {
			$effect(() => {
				if (navigating.to) {
					NProgress.start();
				} else {
					NProgress.done();
				}
			});
			return () => {};
		});
	});
}
