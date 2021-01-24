<template>
  <div>
    <p class="text-center" v-if="loading"><b-spinner variant="secondary" /></p>
    <slot v-else />
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError, handleInfo } from "@/utils";

@Component
export default class VLoading extends Vue {
  @Prop()
  loading: boolean;
}
</script>
