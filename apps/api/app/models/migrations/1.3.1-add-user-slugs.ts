import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

export const migration: Migration = {
  async up() {
    const usersList = await colls.users.find({}).toArray();
    for (const user of usersList) {
      const slug = user.account.username.trim().toLowerCase().replace(/\s+/g, "-");
      await colls.users.updateOne({ _id: user._id }, { $set: { "security.slug": slug } });
    }
  },
};
