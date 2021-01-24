/* tslint:disable:no-console */

import { register } from "register-service-worker";
import store from "./store";

// Disabled - install @vue/cli-plugin-pwa to enable
// Also, on android / chrome it seems there is a continuous refresh bug
// where the refresh prompt does NOT go away
if (process.env.NODE_ENV === "production" && 0) {
  register(`${process.env.BASE_URL}service-worker.js`, {
    ready() {
      console.log(
        "App is being served from cache by a service worker.\n" + "For more details, visit https://goo.gl/AFskqB"
      );
    },
    cached() {
      console.log("Content has been cached for offline use.");
    },
    updated() {
      console.log("New content is available; please refresh.");
      store.commit("updateAvailable");
    },
    offline() {
      console.log("No internet connection found. App is running in offline mode.");
    },
    error(error) {
      console.error("Error during service worker registration:", error);
    },
  });
}
