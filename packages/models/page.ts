import type { Page } from "@bgs/types";

export interface PageDoc extends Page {
  _id: { name: string; lang: string };
}

export const PAGES_COLLECTION = "pages";
