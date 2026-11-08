import { Check, X } from 'lucide-react'
import { type ProcessingStep, type StepId, type StepState } from '@/domain/processingSteps'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const t = strings.processing

// The row, the dot and the label of a step by its state; the state is also said in words (see StepRow).
const rowClass: Record<StepState, string> = {
  done: '',
  active: 'bg-surface-2',
  waiting: '',
  failed: 'bg-problem-bg',
}
const dotClass: Record<StepState, string> = {
  done: 'bg-anchor text-on-anchor',
  active: 'bg-primary-strong',
  waiting: 'bg-border',
  failed: 'bg-problem text-problem-bg',
}
const labelClass: Record<StepState, string> = {
  done: 'text-foreground',
  active: 'text-foreground',
  waiting: 'text-text-muted',
  failed: 'text-problem',
}

function StepRow({ step, note }: { step: ProcessingStep; note?: string }) {
  const label = t.steps[step.id]
  const { state } = step
  const percent = Math.round(step.fraction * 100)

  return (
    <li
      data-state={state}
      aria-current={state === 'active' ? 'step' : undefined}
      className={cn('flex items-center gap-4 rounded-lg px-5 py-4', rowClass[state])}
    >
      <span aria-hidden="true" className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', dotClass[state])}>
        {state === 'done' && <Check className="size-4" strokeWidth={3} />}
        {state === 'failed' && <X className="size-4" strokeWidth={3} />}
      </span>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn('text-[17px] leading-[1.3] font-medium', labelClass[state])}>
            {label}
            {/* A waiting or failed step says so in its note; a done or active one says so for a screen reader. */}
            {(state === 'done' || state === 'active') && (
              <>
                {' '}
                <span className="sr-only">{t.stepStates[state]}</span>
              </>
            )}
          </span>
          <span className={cn('text-sm leading-[1.3] font-normal', state === 'failed' ? 'text-problem' : 'text-text-muted')}>
            {state === 'waiting' || state === 'failed' ? t.stepStates[state] : note}
          </span>
        </div>
        {state === 'active' && (
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 rounded-[3px] bg-surface-3"
          >
            <div className="h-1.5 rounded-[3px] bg-primary-strong" style={{ width: `${percent}%` }} />
          </div>
        )}
        {/* The aligning step is where a job sits at one percentage for minutes: say so while it runs, and only then. */}
        {state === 'active' && step.id === 'matching' && <p className="text-sm leading-[1.3] text-text-muted">{t.longestStep}</p>}
      </div>
    </li>
  )
}

/** The five steps of processing in a card: the dot says where each one is, a note says what a finished one found. */
export function StepList({ steps, notes }: { steps: ProcessingStep[]; notes: Partial<Record<StepId, string>> }) {
  return (
    // role="list" because list-style: none makes Safari drop the list semantics.
    <ol role="list" aria-label={t.stepsLabel} className="flex flex-col gap-1 rounded-card border border-border bg-surface p-2">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} note={notes[step.id]} />
      ))}
    </ol>
  )
}
