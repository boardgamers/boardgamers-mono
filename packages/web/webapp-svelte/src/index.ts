import "bootstrap-icons/font/bootstrap-icons.css";
import "bootstrap/dist/css/bootstrap.min.css";
import App from "./App.svelte";
import "./router";
import "./style.css";

const app = new App({
  target: document.body,
});

export default app;
