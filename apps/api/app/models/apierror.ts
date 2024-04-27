import makeCollection from "@bgs/models/api-error";
import mongoose from "mongoose";

const ApiError = mongoose.model("ApiError", makeCollection());

export { ApiError };
