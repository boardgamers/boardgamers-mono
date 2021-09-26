import AWN from "awesome-notifications";
import "awesome-notifications/dist/style.css";

const notifier = new AWN({ icons: { enabled: false } });

export function handleError(err: Error | string | unknown) {
  if (!err) {
    return;
  }

  console.error(err);

  if (typeof err === "string") {
    notifier.alert(err);
  } else if ("message" in (err as any)) {
    notifier.alert((err as any).message);
  } else {
    notifier.alert("Unknown error");
  }
}

export function handleInfo(info: string) {
  notifier.info(info);
}

export function handleSuccess(info: string) {
  notifier.success(info);
}

export function confirm(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    notifier.confirm(
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
export function defer(target: Function, callback?: () => unknown) {
  return async (...args: any[]) => {
    try {
      return await target(...args);
    } catch (err) {
      handleError(err as Error);
    } finally {
      callback?.();
    }
  };
}
