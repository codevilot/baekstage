import Ajv from "ajv";

export type SchemaValidation = { valid?: boolean; unsupported?: boolean; errors?: string[] };

export function validateOpenApiSchema(schema: unknown, components: unknown, value: unknown): SchemaValidation {
  if (!schema || typeof schema !== "object") return {};
  try {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, discriminator: true });
    const validate = ajv.compile({ components: components ?? {}, allOf: [schema] });
    const valid = validate(value);
    return { valid, errors: valid ? undefined : (validate.errors ?? []).map((error) => `${error.instancePath || "$"} ${error.message ?? "is invalid"}`) };
  } catch (error) {
    return { unsupported: true, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
