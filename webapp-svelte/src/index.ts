import "bootstrap/dist/css/bootstrap.min.css";
import App from "./App.svelte";
import "./router";
import "./style.css";

const app = new App({
  target: document.body,
});

export default app;

// Hot Module Replacement (HMR) - Remove this snippet to remove HMR.
// Learn more: https://www.snowpack.dev/concepts/hot-module-replacement
//@ts-ignore
if (import.meta?.hot) {
  //@ts-ignore
  import.meta.hot.accept();
  //@ts-ignore
  import.meta.hot.dispose(() => {
    app.$destroy();
  });
}
