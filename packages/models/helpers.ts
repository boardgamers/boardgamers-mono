import { ObjectId } from "mongodb";
import { z } from "zod";

export const zObjectId = () =>
  z
    .string()
    .refine((v) => ObjectId.isValid(v), "Invalid ObjectId")
    .transform((v) => new ObjectId(v));

export const zDate = () => z.iso.datetime().transform((v) => new Date(v));
