import AWN from "awesome-notifications";
import "awesome-notifications/dist/style.css";

const notifier = new AWN({ icons: { enabled: false } });

function isError(err: Error | unknown): err is Error {
  return (<any>err)?.message;
}

export function handleError(err: Error | string | unknown) {
  if (!err) {
    return;
  }
  console.error(err);

  if (typeof err !== "object") {
    notifier.alert(err);
  } else if (isError(err)) {
    notifier.alert(err.message);
  } else {
    notifier.alert("Uknown error");
  }
}

export function handleInfo(info: string) {
  notifier.info(info);
}

export function handleSuccess(info: string) {
  notifier.success(info);
}
