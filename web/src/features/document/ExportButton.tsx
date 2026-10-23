import { downloadTextFile } from '../../lib/download'
import { useDocument } from './DocumentProvider'
import { exportFilename } from './exportFilename'

export function ExportButton() {
  const { content } = useDocument()
  return (
    <button
      type="button"
      onClick={() => downloadTextFile(exportFilename(content), content)}
      className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      Export Markdown
    </button>
  )
}
