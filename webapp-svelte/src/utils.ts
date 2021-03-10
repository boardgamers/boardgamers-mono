import AWN from "awesome-notifications";
import "awesome-notifications/dist/style.css";

const notifier = new AWN({ icons: { enabled: false } });

export function handleError(err: Error | string) {
  if (!err) {
    return;
  }

  console.error(err);

  if (typeof err === "string") {
    notifier.alert(err);
  } else if ("message" in err) {
    notifier.alert(err.message);
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
