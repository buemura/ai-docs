import { useModels } from './ModelProvider'

const selectClass =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

export function ModelSelect() {
  const { models, selectedModel, setSelectedModel, status } = useModels()

  if (status !== 'ready') {
    return (
      <select
        aria-label="AI model"
        data-tour="model-select"
        disabled
        className={selectClass}
        value=""
      >
        <option value="">{status === 'loading' ? 'Loading models…' : 'AI unavailable'}</option>
      </select>
    )
  }

  return (
    <select
      aria-label="AI model"
      data-tour="model-select"
      className={selectClass}
      value={selectedModel ?? ''}
      onChange={(event) => setSelectedModel(event.target.value)}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  )
}
