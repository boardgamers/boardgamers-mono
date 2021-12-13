/**
 * Create a watcher. Compared to `watch`, it can have additional options and
 * by default only executes after changes, not the first time
 *
 * @param callback The function to executre when the deps change
 * @param options `options.immediate` is whether or not the function is executed
 * immediately or only on changes. Defaults to false.
 * @returns The watcher. Pass it the deps.
 *
 * @example
 *
 * ```
 * const watcher = createWatcher(() => console.log("executed only on changes on a/b/c"), {immediate: false})
 *
 * $ : watcher(), [a,b,c]
 * ```
 */
export function createWatcher(
  callback: () => unknown,
  { immediate = false }: { immediate: boolean } = { immediate: false }
): () => void {
  // Watchers are typically only useful in the browser, not in SSR
  if (typeof window === "undefined") {
    return () => {};
  }
  let skip = !immediate;

  return () => {
    if (skip) {
      skip = false;
      return;
    }
    callback();
  };
}

export function skipOnce<T extends unknown[]>(callback: (...args: T) => unknown): () => void {
  let skipped = false;
  return (...args: T) => {
    if (!skipped) {
      skipped = true;
      return;
    }

    callback(...args);
  };
}
