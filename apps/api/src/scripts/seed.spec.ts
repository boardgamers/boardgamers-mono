import mongoose from "mongoose";
import { seed } from "./seed";
import { describe, beforeAll, it } from "vitest";

describe("Seed", () => {
  beforeAll(() => mongoose.connection.db.dropDatabase().then(() => {}));

  it("should seed with no problems", async () => {
    await seed();
  });
});
