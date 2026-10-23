import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; onReload?: () => void }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  private handleReload = () => {
    if (this.props.onReload) this.props.onReload()
    else window.location.reload()
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 dark:bg-slate-950">
        <div
          role="alert"
          className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-slate-800 dark:border-red-900 dark:bg-red-950/40 dark:text-slate-100"
        >
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm">
            Your document is saved in this browser. Reload the page to continue.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-white/70 p-2 text-xs dark:bg-black/30">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-slate-100 dark:text-slate-900"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
