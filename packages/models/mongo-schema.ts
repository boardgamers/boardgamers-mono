import type { ZodType } from "zod";
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

const typeToBsonType: Record<string, string> = {
  string: "string",
  number: "double",
  integer: "int",
  boolean: "bool",
  object: "object",
  array: "array",
  null: "null",
};

function convert(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};

  if (schema.format === "objectId") {
    return { bsonType: "objectId" };
  }

  if (schema.format === "date-time") {
    return { bsonType: "date" };
  }

  if (typeof schema.type === "string") {
    out.bsonType = typeToBsonType[schema.type] ?? schema.type;
  }

  if (schema.enum) {
    out.enum = schema.enum;
  }

  if (schema.required) {
    out.required = schema.required;
  }

  if (schema.properties && typeof schema.properties === "object") {
    const props: JsonSchema = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, JsonSchema>)) {
      props[key] = convert(val);
    }
    out.properties = props;
  }

  if (schema.items && typeof schema.items === "object") {
    out.items = convert(schema.items as JsonSchema);
  }

  if (Array.isArray(schema.oneOf)) {
    out.oneOf = (schema.oneOf as JsonSchema[]).map(convert);
  }

  if (Array.isArray(schema.anyOf)) {
    out.anyOf = (schema.anyOf as JsonSchema[]).map(convert);
  }

  if (typeof schema.minimum === "number") {
    out.minimum = schema.minimum;
  }
  if (typeof schema.maximum === "number") {
    out.maximum = schema.maximum;
  }
  if (typeof schema.exclusiveMinimum === "number") {
    out.exclusiveMinimum = schema.exclusiveMinimum;
  }
  if (typeof schema.exclusiveMaximum === "number") {
    out.exclusiveMaximum = schema.exclusiveMaximum;
  }
  if (typeof schema.minLength === "number") {
    out.minLength = schema.minLength;
  }
  if (typeof schema.maxLength === "number") {
    out.maxLength = schema.maxLength;
  }
  if (typeof schema.minItems === "number") {
    out.minItems = schema.minItems;
  }
  if (typeof schema.maxItems === "number") {
    out.maxItems = schema.maxItems;
  }
  if (typeof schema.pattern === "string") {
    out.pattern = schema.pattern;
  }
  if (typeof schema.description === "string") {
    out.description = schema.description;
  }
  if (typeof schema.title === "string") {
    out.title = schema.title;
  }

  return out;
}

export function zodToMongoSchema(schema: ZodType): JsonSchema {
  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-07" });
  return convert(jsonSchema as JsonSchema);
}
