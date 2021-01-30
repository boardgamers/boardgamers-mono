<template>
  <div>
    <form @submit.prevent="updatePage">
      <v-text-field label="Page title" v-model="page.title" required></v-text-field>
      <v-text-field label="Page id" v-model="page._id.name" required :disabled="mode !== 'new'"></v-text-field>
      <v-text-field label="Page language" v-model="page._id.lang" :disabled="mode !== 'new'" required />

      <input type="submit" class="d-none" />
    </form>

    <h3>Content</h3>
    <editor :options="{ usageStatistics: false }" class="page-editor mt-2" ref="content" :initialValue="page.content" />

    <v-btn type="primary" color="primary" class="mt-3 float-right" @click="updatePage">Save</v-btn>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { Page } from "../types";

@Component
export default class PageEdit extends Vue {
  @Prop()
  value?: Page;

  page: Page = {
    _id: {
      name: "",
      lang: "en",
    },
    title: "",
    content: "",
  };

  @Prop({ default: "edit" })
  mode!: "new" | "edit";

  updatePage() {
    this.page.content = (this.$refs.content as any).invoke("getMarkdown");

    this.$emit("page:update", this.page);
  }

  @Watch("value", { immediate: true })
  replace() {
    if (this.value) {
      const data: Page = JSON.parse(JSON.stringify(this.value));

      this.page = data;

      if (this.$refs.content) {
        (this.$refs.content as any).invoke("setMarkdown", data.content, false);
      }
    }
  }
}
</script>
<style lang="scss" scoped>
.page-editor {
  height: 500px !important;
}
</style>
