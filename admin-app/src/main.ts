import Vue from "vue";
import App from "./App.vue";
import "./filters";
import "./plugins/axios";
import "./plugins/markdown";
import vuetify from "./plugins/vuetify";
import router from "./router";
import store from "./store";

Vue.config.productionTip = false;

new Vue({
  router,
  store,
  ...({ vuetify } as any),
  render: (h) => h(App),
}).$mount("#app");
