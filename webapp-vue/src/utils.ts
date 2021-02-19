import { AxiosError } from "axios";
import marked from "marked";
import store from "./store";

function isAxiosError(err: AxiosError | any): err is AxiosError {
  return err.isAxiosError;
}

function isError(err: Error): err is Error {
  return (<any>err).message;
}

export function handleError(err: Error | AxiosError | string) {
  if (!err) {
    return;
  }
  console.error(err);

  if (typeof err !== "object") {
    store.commit("error", err);
  } else if (isAxiosError(err) && err.response?.data?.message) {
    store.commit("error", err.response.data.message);
    console.error(err.response.data);
  } else if (isError(err)) {
    store.commit("error", err.message);
  } else {
    store.commit("error", "Unknown error");
  }
}

export function handleInfo(info: string) {
  store.commit("info", info);
}

export function upperFirst(str: string) {
  return str[0].toUpperCase() + str.slice(1);
}

export function timerTime(value: number) {
  const d = new Date();
  const date = new Date(d.setHours(0, 0, 0, 0) - d.getTimezoneOffset() * 60000 + value * 1000);

  return `${date.getHours().toString().padStart(2, "0")}h${
    date.getMinutes() ? date.getMinutes().toString().padStart(2, "0") : ""
  }`;
}

export function oneLineMarked(text: string) {
  return marked(text).replace(/<\/?p>/g, "");
}

export function pad(x: string | number, n: number) {
  return ("" + x).padStart(n, "0");
}

export function niceDate(date: string | Date): string {
  if (!date) {
    return date as any;
  }
  if (typeof date === "string") {
    if (date.length > 10) {
      const ms = Date.parse(date);

      if (ms) {
        return niceDate(new Date(ms));
      }
      return date;
    }
    if (date.length === 8) {
      return date.substr(6, 2) + "/" + date.substr(4, 2) + "/" + date.substr(2, 2);
    } else {
      return date.substr(8, 2) + "/" + date.substr(5, 2) + "/" + date.substr(2, 2);
    }
  } else {
    return (
      pad(date.getDate(), 2) + "/" + pad(date.getMonth() + 1, 2) + "/" + date.getFullYear().toString().substr(2, 2)
    );
  }
}

export function dateFromObjectId(objectId: string) {
  return new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
}
