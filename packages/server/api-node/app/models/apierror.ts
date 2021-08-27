import makeSchema from "@shared/models/api-error";
import mongoose from "mongoose";

const ApiError = mongoose.model("ApiError", makeSchema());

export { ApiError };
