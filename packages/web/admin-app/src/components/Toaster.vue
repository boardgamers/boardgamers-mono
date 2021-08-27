<template>
  <v-snackbar v-model="show" top :color="color">
    {{ message }}
  </v-snackbar>
</template>
<script lang="ts">
import store from "../store";
import { Vue, Component, Prop, Watch } from "vue-property-decorator";

@Component({
  created(this: Toaster) {
    const subscription = this.$store.subscribe((mutation, state) => {
      if (mutation.type === "info") {
        this.color = "info";
        this.show = true;
        this.message = mutation.payload;
      } else if (mutation.type === "success") {
        this.color = "success";
        this.show = true;
        this.message = mutation.payload;
      } else if (mutation.type === "error") {
        this.color = "error";
        this.show = true;
        this.message = mutation.payload;
      }
    });

    this.$on("hook:beforeDestroy", subscription);
  },
})
export default class Toaster extends Vue {
  message = "";
  show = false;
  color = "info";
}
</script>
