import { colls } from "../../config/db.ts";
import { recalculateKarma } from "../user.ts";
import type { Migration } from "./index.ts";

export const migration: Migration = {
  async up() {
    const usersList = await colls.users.find({}).toArray();
    for (const user of usersList) {
      await recalculateKarma(user);
    }
  },
};
