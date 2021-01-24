<template>
  <div />
</template>
<script lang="ts">
import Vue from "vue";
import { Component } from "vue-property-decorator";

@Component<Alert>({
  created() {
    const unsub = this.$store.subscribe((mutation, state) => {
      if (mutation.type === "info") {
        this.$bvToast.toast(mutation.payload, { variant: "info", title: "Info" });
      } else if (mutation.type === "error") {
        this.$bvToast.toast(mutation.payload, { variant: "danger", title: "Error" });
      }
    });

    this.$once("hook:beforeDestroy", unsub);
  },
})
export default class Alert extends Vue {}
</script>
