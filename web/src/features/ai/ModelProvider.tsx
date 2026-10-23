import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { z } from 'zod'
import { loadJson, saveJson } from '../../lib/storage'
import { fetchModels } from './api'
import type { ModelInfo } from './schemas'

export const MODEL_STORAGE_KEY = 'ai-docs:model'

type CatalogState = {
  status: 'loading' | 'ready' | 'error'
  models: ModelInfo[]
  defaultModel: string | null
}

export type ModelsContextValue = {
  models: ModelInfo[]
  selectedModel: string | null
  setSelectedModel(id: string): void
  status: CatalogState['status']
}

const ModelsContext = createContext<ModelsContextValue | null>(null)

function pickModel(catalog: CatalogState, stored: string): string | null {
  if (catalog.status !== 'ready') return null
  const ids = catalog.models.map((model) => model.id)
  if (ids.includes(stored)) return stored
  if (catalog.defaultModel && ids.includes(catalog.defaultModel)) return catalog.defaultModel
  return ids[0] ?? null
}

export function ModelProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CatalogState>({
    status: 'loading',
    models: [],
    defaultModel: null,
  })
  const [storedModel, setStoredModel] = useState(() => loadJson(MODEL_STORAGE_KEY, z.string(), ''))

  useEffect(() => {
    const controller = new AbortController()
    fetchModels(controller.signal)
      .then((response) =>
        setCatalog({
          status: 'ready',
          models: response.models,
          defaultModel: response.default_model,
        }),
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setCatalog({ status: 'error', models: [], defaultModel: null })
        }
      })
    return () => controller.abort()
  }, [])

  const setSelectedModel = useCallback((id: string) => {
    setStoredModel(id)
    saveJson(MODEL_STORAGE_KEY, id)
  }, [])

  const value = useMemo<ModelsContextValue>(
    () => ({
      models: catalog.models,
      status: catalog.status,
      selectedModel: pickModel(catalog, storedModel),
      setSelectedModel,
    }),
    [catalog, storedModel, setSelectedModel],
  )

  return <ModelsContext.Provider value={value}>{children}</ModelsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useModels(): ModelsContextValue {
  const value = useContext(ModelsContext)
  if (!value) throw new Error('useModels must be used inside <ModelProvider>')
  return value
}
