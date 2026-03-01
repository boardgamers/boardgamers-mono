import mongoose from "mongoose";
import { seed } from "./seed.ts";

describe("Seed", () => {
  before(() => mongoose.connection.db.dropDatabase());

  it("should seed with no problems", async () => {
    await seed();
  });
});
