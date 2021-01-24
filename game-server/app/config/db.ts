import locks from "mongo-locks";
import mongoose from "mongoose";
import env from "./env";

mongoose.connect(env.dbUrl, { dbName: "gaia-project", useNewUrlParser: true });

mongoose.connection.on("error", (err) => {
  console.error(err);
});

mongoose.connection.on("open", async () => {
  console.log("connected to database!");
});

locks.init(mongoose.connection);
