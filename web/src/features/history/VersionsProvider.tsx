import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { createId } from '../../lib/id'
import { loadJson, saveJson } from '../../lib/storage'
import { useDocument } from '../document/DocumentProvider'
import {
  MAX_VERSIONS,
  VERSIONS_STORAGE_KEY,
  VersionsSchema,
  type Version,
  type VersionInput,
} from './types'
import { trimForQuota, versionsReducer } from './versionsReducer'

type VersionsContextValue = {
  versions: Version[]
  record(input: VersionInput): void
  restore(versionId: string): void
}

const VersionsContext = createContext<VersionsContextValue | null>(null)

function createVersion(input: VersionInput): Version {
  return { ...input, id: createId(), createdAt: Date.now() }
}

function loadInitialVersions(content: string): Version[] {
  const stored = loadJson(VERSIONS_STORAGE_KEY, VersionsSchema, [])
  if (stored.length > 0) return stored.slice(-MAX_VERSIONS)
  return [createVersion({ source: 'initial', label: 'Initial version', content })]
}

export function VersionsProvider({ children }: { children: ReactNode }) {
  const { content, setContent } = useDocument()
  const [versions, dispatch] = useReducer(versionsReducer, content, loadInitialVersions)

  useEffect(() => {
    if (!saveJson(VERSIONS_STORAGE_KEY, versions)) {
      saveJson(VERSIONS_STORAGE_KEY, trimForQuota(versions))
    }
  }, [versions])

  const record = useCallback((input: VersionInput) => {
    dispatch({ type: 'record', version: createVersion(input) })
  }, [])

  const restore = useCallback(
    (versionId: string) => {
      const target = versions.find((version) => version.id === versionId)
      if (!target) return
      setContent(target.content)
      record({ source: 'restore', label: `Restored "${target.label}"`, content: target.content })
    },
    [versions, setContent, record],
  )

  const value = useMemo(() => ({ versions, record, restore }), [versions, record, restore])

  return <VersionsContext.Provider value={value}>{children}</VersionsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useVersions(): VersionsContextValue {
  const context = useContext(VersionsContext)
  if (!context) throw new Error('useVersions must be used within a VersionsProvider')
  return context
}
