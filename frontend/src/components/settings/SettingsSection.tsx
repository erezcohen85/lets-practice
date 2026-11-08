import { useId, type ReactNode } from 'react'

/** One group of settings under a small capitals heading. An error sits at the end of the group it belongs to. */
export function SettingsSection({ title, error, children }: { title: string; error?: string | null; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-sm font-semibold tracking-[0.06em] text-text-muted uppercase">
        {title}
      </h2>
      {children}
      {error ? (
        <p role="alert" className="text-[15px] text-problem">
          {error}
        </p>
      ) : null}
    </section>
  )
}
