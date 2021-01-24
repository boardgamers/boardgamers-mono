import Vue from "vue";
import App from "./App.vue";
import router from "./router";
import store from "./store";
import "./plugins/axios";
import "./plugins/markdown";
import "./filters";
import vuetify from "./plugins/vuetify";

Vue.config.productionTip = false;

new Vue({
  router,
  store,
  ...({ vuetify } as any),
  render: (h) => h(App),
}).$mount("#app");
