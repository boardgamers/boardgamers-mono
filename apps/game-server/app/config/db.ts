import mongoose from "mongoose";
import env from "./env.ts";
import locks from "./locks.ts";

const connect = () =>
  mongoose
    .connect(env.database.bgs.url, { dbName: env.database.bgs.name, directConnection: true })
    .then(() => console.log("successfully connected to database"));

connect().catch((err) => {
  console.error(err);
});

mongoose.connection.on("error", (err) => {
  console.error(err);
});

mongoose.connection.on("disconnected", () => {
  console.log("attempt to reconnect to database");
  setTimeout(() => connect().catch(console.error), 5000);
});

locks.init(mongoose.connection.db!.collection("locks"));
