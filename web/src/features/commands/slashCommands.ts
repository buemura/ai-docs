import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { AI_PRESETS, ASK_SLASH, type AiPreset } from './presets'

export type SlashSelection =
  | { kind: 'preset'; preset: AiPreset; content: string; cursor: number }
  | { kind: 'ask'; content: string; cursor: number }

const SLASH_BEFORE_CURSOR = /(?:^|\s)\/[\w-]*$/
const SLASH_WORD = /^\/[\w-]*$/

function removeSlashText(view: EditorView, from: number, to: number) {
  view.dispatch({
    changes: { from, to, insert: '' },
    selection: { anchor: from },
    userEvent: 'delete.slash',
  })
  return { content: view.state.doc.toString(), cursor: from }
}

export function slashCompletionSource(
  onSelect: (selection: SlashSelection) => void,
): CompletionSource {
  const askOption: Completion = {
    label: `/${ASK_SLASH}`,
    detail: 'Ask AI with your own instruction',
    type: 'function',
    apply: (view, _completion, from, to) =>
      onSelect({ kind: 'ask', ...removeSlashText(view, from, to) }),
  }
  const presetOptions: Completion[] = AI_PRESETS.map((preset) => ({
    label: `/${preset.slash}`,
    detail: preset.label,
    type: 'function',
    apply: (view, _completion, from, to) =>
      onSelect({ kind: 'preset', preset, ...removeSlashText(view, from, to) }),
  }))
  const options = [askOption, ...presetOptions]

  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(SLASH_BEFORE_CURSOR)
    if (!match) return null
    const from = match.text.startsWith('/') ? match.from : match.from + 1
    return { from, options, validFor: SLASH_WORD }
  }
}

export function slashCommands(onSelect: (selection: SlashSelection) => void): Extension {
  return autocompletion({ override: [slashCompletionSource(onSelect)], icons: false })
}
