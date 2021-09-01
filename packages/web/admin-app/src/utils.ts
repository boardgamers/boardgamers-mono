import { AxiosError } from "axios";
import store from "./store";

function isAxiosError(err: AxiosError | any): err is AxiosError {
  return err.isAxiosError;
}

function isError(err: Error | unknown): err is Error {
  return (<any>err)?.message;
}

export function handleError(err: Error | AxiosError | string | unknown) {
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

export function handleSuccess(info: string) {
  store.commit("success", info);
}

export function upperFirst(str: string) {
  return str[0].toUpperCase() + str.slice(1);
}
