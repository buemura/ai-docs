import { z } from 'zod'

export const modelInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
})

export const modelsResponseSchema = z.object({
  provider: z.string(),
  default_model: z.string(),
  models: z.array(modelInfoSchema),
})

export const deltaPayloadSchema = z.object({ text: z.string() })
export const donePayloadSchema = z.object({ stop_reason: z.string() })
export const errorPayloadSchema = z.object({ code: z.string(), message: z.string() })

export type ModelInfo = z.infer<typeof modelInfoSchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>

export type SuggestionRequestBody = {
  model: string
  document: string
  selection: { start: number; end: number } | null
  instruction: string
  history: { instruction: string; proposal: string }[]
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; code: string; message: string }
