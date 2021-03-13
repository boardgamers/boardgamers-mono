/**
 * Allows to call an expression each time deps are modified, and once initially
 *
 * @param callback
 * @param deps
 * @param options You can give `{skipOnce: true}` to not run the first time. Must be stored in a variable and not directly in the body of the `watch` call
 *
 * @example
 *
 * ```
 * const options = {skipOnce: true}
 * const immediate = () => console.log("executed immediately and on changes")
 * const onlyOnChanges = () => console.log("executed only on changes")
 *
 * $ : watch(immediate, [a, b, c])
 * $ : watch(onlyOnChanges, [a, b, d], options)
 * ```
 */
export function watch(callback: () => unknown, _deps: any[], options?: { skipOnce: boolean }) {
  if (options?.skipOnce) {
    options.skipOnce = false;
    return;
  }

  callback();
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
