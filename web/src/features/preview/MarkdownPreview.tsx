import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const remarkPlugins = [remarkGfm]

const components: Components = {
  a: ({ node, ...props }) => {
    void node
    return <a {...props} target="_blank" rel="noreferrer" />
  },
}

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <article
        aria-label="Markdown preview"
        className="prose prose-slate mx-auto max-w-3xl dark:prose-invert"
      >
        {content.trim() === '' ? (
          <p className="text-slate-500">Nothing to preview yet.</p>
        ) : (
          <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
            {content}
          </ReactMarkdown>
        )}
      </article>
    </div>
  )
}
