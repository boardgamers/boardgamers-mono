import { ObjectId } from "mongodb";
import { z } from "zod";

export function zObjectId() {
  return z.string().transform((val, ctx) => {
    if (!ObjectId.isValid(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid ObjectId" });
      return z.NEVER;
    }
    return new ObjectId(val);
  });
}
