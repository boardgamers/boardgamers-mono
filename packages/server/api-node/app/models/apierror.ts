import makeSchema from "@bgs/models/api-error";
import mongoose from "mongoose";

const ApiError = mongoose.model("ApiError", makeSchema());

export { ApiError };
