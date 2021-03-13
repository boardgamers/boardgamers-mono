/**
 * Allows to call an expression each time deps are modified, and once initially
 *
 * @param callback
 * @param deps
 *
 * @example
 *
 * ```
 * const immediate = () => console.log("executed immediately and on changes")
 *
 * $ : watch(immediate, [a, b, c])
 * ```
 */
export function watch(callback: () => unknown, _deps: any[]) {
  callback();
}

/**
 * Create a watcher. Compared to `watch`, it can have additional options
 *
 * @param callback The function to executre when the deps change
 * @param options `options.immediate` is whether or not the function is executed
 * immediately or only on changes
 * @returns The watcher. Pass it the deps.
 *
 * @example
 *
 * ```
 * const watcher = createWatcher(() => console.log("executed only on changes on a/b/c"), {immediate: false})
 *
 * $ : watcher(a, b, c)
 * ```
 */
export function createWatcher(callback: () => unknown, options: { immediate: boolean }) {
  let skip = !options.immediate;

  return (..._deps: any[]) => {
    if (skip) {
      skip = false;
      return;
    }
    callback();
  };
}

export function skipOnce(callback: () => unknown) {
  let skipped = false;
  return () => {
    if (!skipped) {
      skipped = true;
      return;
    }

    callback();
  };
}
