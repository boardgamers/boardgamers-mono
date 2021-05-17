import locks from "mongo-locks";
import mongoose from "mongoose";
import env from "./env";

mongoose.connect(env.database.bgs.url, { dbName: env.database.bgs.name, useNewUrlParser: true }).catch((err) => {
  console.error(err);
  process.exit(1);
});

mongoose.connection.on("error", (err) => {
  console.error(err);
});

mongoose.connection.on("open", async () => {
  console.log("connected to database!");
});

locks.init(mongoose.connection);
