/**
 * Utility functions for the tool system.
 */

import type { z } from 'zod'
import { zodToJsonSchema as zodToJsonSchemaLib } from 'zod-to-json-schema'

/**
 * Convert a Zod schema to JSON Schema format.
 * Uses zod-to-json-schema for comprehensive type support including
 * unions, literals, records, tuples, and other complex types.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const fullSchema = zodToJsonSchemaLib(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7'
  })
  // Remove $schema metadata since Claude API doesn't need it
  const { $schema, ...schemaWithoutMeta } = fullSchema as Record<string, unknown>
  return schemaWithoutMeta
}
