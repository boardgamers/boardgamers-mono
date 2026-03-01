import { Types } from "mongoose";
import { z } from "zod";

export function zObjectId() {
  return z.string().transform((val, ctx) => {
    if (!Types.ObjectId.isValid(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid ObjectId" });
      return z.NEVER;
    }
    return new Types.ObjectId(val);
  });
}
