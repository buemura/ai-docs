import { z } from 'zod'

/** UTF-16 offsets into the document, from <= to. */
export type TextRange = { from: number; to: number }

export const DOCUMENT_STORAGE_KEY = 'ai-docs:document'

export const storedDocumentSchema = z.object({
  content: z.string(),
  updatedAt: z.number(),
})

export type StoredDocument = z.infer<typeof storedDocumentSchema>
