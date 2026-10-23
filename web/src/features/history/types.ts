import { z } from 'zod'

export const VERSIONS_STORAGE_KEY = 'ai-docs:versions'
export const MAX_VERSIONS = 100
export const QUOTA_FALLBACK_KEEP = 20

export const VersionSourceSchema = z.enum(['initial', 'manual', 'ai', 'restore'])

export const VersionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  source: VersionSourceSchema,
  label: z.string(),
  model: z.string().optional(),
  content: z.string(),
})

export const VersionsSchema = z.array(VersionSchema)

export type VersionSource = z.infer<typeof VersionSourceSchema>
export type Version = z.infer<typeof VersionSchema>
export type VersionInput = Omit<Version, 'id' | 'createdAt'>
