import { browser } from "$app/env";
import { isPromise } from "@bgs/utils";
import "awesome-notifications/dist/style.css";

let notifier: any | undefined;

if (browser) {
  import("awesome-notifications").then((AWN) => (notifier = new AWN.default({ icons: { enabled: false } })));
}

export function handleError(err: Error | string | unknown): void {
  if (!err || !browser) {
    return;
  }

  console.error(err);

  if (typeof err === "string") {
    notifier?.alert(err);
  } else if ("message" in (err as any)) {
    notifier?.alert((err as any).message);
  } else {
    notifier?.alert("Unknown error");
  }
}

export function handleInfo(info: string): void {
  notifier?.info(info);
}

export function handleSuccess(info: string): void {
  notifier?.success(info);
}

export function confirm(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    notifier?.confirm(
      text,
      () => resolve(true),
      () => resolve(false)
    );
  });
}

/**
 * Creates a function that will execute the target function, handle thrown error, and finally
 * execute `callback`
 *
 * @param target Function to wrap
 * @param callback Callback to always execute at the end
 * @returns wrapped function
 */
export function defer(target: (...args: any[]) => any, callback?: () => unknown) {
  return (...args: any[]) => {
    try {
      const res = target(...args);

      if (isPromise(res)) {
        return res.catch(handleError).finally(() => callback?.());
      }
    } catch (err) {
      handleError(err as Error);
    } finally {
      callback?.();
    }
  };
}
