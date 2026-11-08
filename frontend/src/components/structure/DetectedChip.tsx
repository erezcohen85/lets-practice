import { type BarTally } from '@/domain/shortBars'
import { strings } from '@/strings'

const text = strings.structure.bars

const same = (a: BarTally, b: BarTally) => a.printed === b.printed && pickupsOf(a) === pickupsOf(b)

/** Every pickup of a tally: the top one and the ones with no number of their own. */
const pickupsOf = ({ pickup, pickups = 0 }: BarTally) => (pickup ? 1 : 0) + pickups

/** "Detected: 64 bars", and "· Now: 65 bars" once an edit has changed the count since the Editor opened. */
export function DetectedChip({ detected, now }: { detected: BarTally; now: BarTally }) {
  return (
    <p data-slot="detected-chip" className="inline-flex w-fit items-center gap-2 rounded-full border border-border-strong bg-surface-2 px-3 py-1 text-[13px] text-text-soft">
      <span aria-hidden className="size-2 rounded-full bg-loop" />
      <span>
        {text.detected} <strong className="font-semibold text-loop">{text.count(detected.printed, pickupsOf(detected))}</strong>
      </span>
      {!same(detected, now) && (
        <span className="text-text-muted">
          · {text.now} <strong className="font-semibold text-primary-strong">{text.count(now.printed, pickupsOf(now))}</strong>
        </span>
      )}
    </p>
  )
}
