import makeSchema from "@lib/schemas/api-error";
import mongoose from "mongoose";

const ApiError = mongoose.model("ApiError", makeSchema());

export default ApiError;
