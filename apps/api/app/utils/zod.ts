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

/**
 * Parses a `ctx.query` value (a single string) into a finite number.
 * Rejects arrays, empty strings, and non-numeric input.
 */
export const zNumberQuery = () =>
  z
    .string()
    .min(1)
    .transform((val, ctx) => {
      const n = Number(val);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a number" });
        return z.NEVER;
      }
      return n;
    });

/**
 * Parses a `ctx.query` value (a single string) into a finite integer.
 * Rejects arrays, empty strings, and non-integer input.
 */
export const zIntQuery = () =>
  zNumberQuery().refine((n) => Number.isInteger(n), { message: "Expected an integer" });

/**
 * Accepts only a single string value from `ctx.query` (rejects arrays).
 */
export const zStringQuery = () => z.string();
