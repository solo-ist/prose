/**
 * Utility functions for the tool system.
 */

import type { z } from 'zod'

/**
 * Convert a Zod schema to JSON Schema format.
 * This is a simplified converter that handles the common cases.
 * For full compatibility, consider using zod-to-json-schema package.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return zodTypeToJsonSchema(schema)
}

function zodTypeToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def

  // Handle ZodEffects (transformations, refinements)
  if (def.typeName === 'ZodEffects' && def.schema) {
    const result = zodTypeToJsonSchema(def.schema)
    if (def.description) {
      result.description = def.description
    }
    return result
  }

  // Handle optional (make the inner type nullable or mark not required)
  if (def.typeName === 'ZodOptional') {
    return zodTypeToJsonSchema(def.innerType)
  }

  // Handle default (use inner type)
  if (def.typeName === 'ZodDefault') {
    const inner = zodTypeToJsonSchema(def.innerType)
    inner.default = def.defaultValue()
    return inner
  }

  // Handle string
  if (def.typeName === 'ZodString') {
    const result: Record<string, unknown> = { type: 'string' }
    if (def.description) result.description = def.description
    return result
  }

  // Handle number
  if (def.typeName === 'ZodNumber') {
    const result: Record<string, unknown> = { type: 'number' }
    if (def.description) result.description = def.description
    return result
  }

  // Handle boolean
  if (def.typeName === 'ZodBoolean') {
    const result: Record<string, unknown> = { type: 'boolean' }
    if (def.description) result.description = def.description
    return result
  }

  // Handle enum
  if (def.typeName === 'ZodEnum') {
    const result: Record<string, unknown> = {
      type: 'string',
      enum: def.values
    }
    if (def.description) result.description = def.description
    return result
  }

  // Handle object
  if (def.typeName === 'ZodObject') {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    const shape = def.shape()
    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodTypeAny
      properties[key] = zodTypeToJsonSchema(zodValue)

      // Check if required (not optional, not default)
      const valueDef = zodValue._def
      if (valueDef.typeName !== 'ZodOptional' && valueDef.typeName !== 'ZodDefault') {
        required.push(key)
      }
    }

    const result: Record<string, unknown> = {
      type: 'object',
      properties,
      additionalProperties: false
    }

    if (required.length > 0) {
      result.required = required
    }

    if (def.description) {
      result.description = def.description
    }

    return result
  }

  // Handle array
  if (def.typeName === 'ZodArray') {
    const result: Record<string, unknown> = {
      type: 'array',
      items: zodTypeToJsonSchema(def.type)
    }
    if (def.description) result.description = def.description
    return result
  }

  // Fallback for unknown types
  return { type: 'object' }
}
