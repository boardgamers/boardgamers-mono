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

function toClassName(value: any) {
  let result = "";

  if (typeof value === "string" || typeof value === "number") {
    result += value;
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      result = value.map(toClassName).filter(Boolean).join(" ");
    } else {
      for (let key in value) {
        if (value[key]) {
          result && (result += " ");
          result += key;
        }
      }
    }
  }

  return result;
}

export function classnames(...args: any[]) {
  return args.map(toClassName).filter(Boolean).join(" ");
}
