import { before, describe, it } from "node:test";
import mongoose from "mongoose";
import { setup } from "../app/config/test-setup.ts";
import { seed } from "./seed.ts";

describe("Seed", () => {
  before(async () => {
    await setup();
    await mongoose.connection.db.dropDatabase();
  });

  it("should seed with no problems", async () => {
    await seed();
  });
});
