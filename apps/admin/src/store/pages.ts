import { Page } from "@bgs/models";
import { defineStore } from "pinia";
import { ref } from "vue-demi";

export const usePageStore = defineStore("pages", () => {
  const pages = ref<Page[]>([]);

  return {
    pages,
  };
});
