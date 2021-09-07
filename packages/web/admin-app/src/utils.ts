import { notifications } from "./events/notifications";

function isError(err: Error | unknown): err is Error {
  return (<any>err)?.message;
}

export function handleError(err: Error | string | unknown) {
  if (!err) {
    return;
  }
  console.error(err);

  if (typeof err !== "object") {
    notifications.emit({ type: "error", message: (err as unknown) as string });
  } else if (isError(err)) {
    notifications.emit({ type: "error", message: err.message });
  } else {
    notifications.emit({ type: "error", message: "Unknown error" });
  }
}

export function handleInfo(info: string) {
  notifications.emit({ type: "info", message: info });
}

export function handleSuccess(info: string) {
  notifications.emit({ type: "success", message: info });
}

export function upperFirst(str: string) {
  return str[0].toUpperCase() + str.slice(1);
}
