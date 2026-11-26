/**
 * Utility functions for the tool system.
 */

import { z } from 'zod'

/**
 * Convert a Zod schema to JSON Schema format.
 * Uses zod 4's built-in z.toJSONSchema with io:"input" so that fields
 * declared optional-with-default are NOT listed in `required` (the caller
 * may omit them; zod applies the default at parse time). `additionalProperties:
 * false` is reinstated for object types to match the original zod-3 output and
 * to signal to the model not to add undeclared properties.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const fullSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  // Remove $schema metadata since Claude API doesn't need it
  const { $schema, ...schemaWithoutMeta } = fullSchema
  // Reinstate additionalProperties: false for plain object types — io:"input"
  // omits it, but zod strips extra keys by default and signalling that to the
  // model reduces hallucinated extra fields.
  if (schemaWithoutMeta.type === 'object' && !('additionalProperties' in schemaWithoutMeta)) {
    schemaWithoutMeta.additionalProperties = false
  }
  return schemaWithoutMeta
}
