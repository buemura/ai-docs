import { AI_PRESETS, type AiPreset } from './presets'

const CHIP_IDS = ['improve', 'fix', 'shorten', 'tone-professional']
const CHIPS = CHIP_IDS.map((id) => AI_PRESETS.find((p) => p.id === id)).filter(
  (p): p is AiPreset => p !== undefined,
)

export function PresetChips({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick(preset: AiPreset): void
}) {
  return (
    <div role="group" aria-label="Quick AI actions" className="flex flex-wrap gap-2">
      {CHIPS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(preset)}
          title={`/${preset.slash}`}
          className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
