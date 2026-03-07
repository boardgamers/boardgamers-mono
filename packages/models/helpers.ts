import { ObjectId } from "mongodb";
import { z } from "zod";

export const zObjectId = () =>
  z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .meta({ format: "objectId" })
    .transform((v) => new ObjectId(v));

export const zDate = () => z.iso.datetime().transform((v) => new Date(v));
