<template>
  <v-loading :loading="loading" class="page container">
    <h1>{{ pageContent.title }}</h1>
    <div v-html="marked(pageContent.content)"></div>
  </v-loading>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import { Page as IPage } from "@lib/page";
import marked from "marked";

@Component
export default class Page extends Vue {
  loading = true;
  pageContent: Partial<IPage> = {
    content: "",
    title: "",
  };
  marked = marked;

  @Prop()
  page!: string;

  @Watch("page", { immediate: true })
  async update() {
    this.loading = true;
    try {
      this.pageContent = await this.$axios.get(`/page/${this.page}`).then((r) => r.data);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
    }
  }
}
</script>
<style lang="scss">
@import "../stylesheets/variables.scss";

.page {
  pre {
    background: #eee;
    padding: 10px;
    border-radius: 4px;
  }
}
</style>
