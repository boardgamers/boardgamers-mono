import type { Page as IPage } from "@gaia-project/site-lib/page";
import mongoose from "mongoose";

interface PageDocument extends mongoose.Document, IPage {
  _id: {
    name: string;
    lang: string;
  };
}

const schema = new mongoose.Schema({
  _id: {
    name: String,
    lang: String,
  },

  title: String,
  content: String,
});

const Page = mongoose.model<PageDocument>("page", schema);

export default Page;
