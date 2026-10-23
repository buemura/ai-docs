export function TourButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Take the tour"
      title="Take the tour"
      className="rounded-md px-2 py-1 text-lg hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-slate-800"
    >
      <span aria-hidden="true">?</span>
    </button>
  )
}
