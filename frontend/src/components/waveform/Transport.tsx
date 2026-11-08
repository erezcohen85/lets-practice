import { PlayRing } from '@/components/practice/PlayRing'
import { formatClock } from '@/components/waveform/dockLayout'
import { useBarNames } from '@/lib/barNamesContext'
import { type Transport } from '@/lib/useTransport'
import { barWithPass, strings } from '@/strings'

const text = strings.dock

export interface TransportRowProps {
  transport: Transport
  /** The piece has no recording to play (still processing): Play is off and a note says so. */
  unavailable: boolean
  /** The bar under the playhead, or the selected one; null shows no chip. */
  bar: number | null
  /** Which time through the bar it is (0 the first); the chip reads "Bar 12 (2)" from the second on, "Bar p7 (2)" on a pickup. */
  passIndex?: number
  /** Why the last edit was refused, for a few seconds. The only text the row ever shows besides the note for a piece with no recording; it wraps, it is not cut short. */
  refusal?: string | null
  /** Locators moved by hand and not yet resolved; a chip says so when there are some. */
  movedCount?: number
}

/** The row above the waveform: the play ring (88 px, the one of Practice), the time, the bar chip and, briefly, the reason an edit was refused (board: Editor.png). */
export function TransportRow({ transport, unavailable, bar, passIndex = 0, refusal = null, movedCount = 0 }: TransportRowProps) {
  const names = useBarNames()
  const { ready, playing, timeSec, durationSec, toggle } = transport
  return (
    <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
      <PlayRing size="fixed" playing={playing} progress={durationSec ? timeSec / durationSec : 0} disabled={!ready} onToggle={toggle} />
      <span aria-label={text.timeLabel} role="timer" className="shrink-0 font-semibold tabular-nums">
        <span className="text-2xl">{formatClock(timeSec)}</span>
        {' '}
        <span className="text-sm text-text-muted">{text.timeTotal(formatClock(durationSec ?? 0))}</span>
      </span>
      {bar !== null && (
        <span
          aria-label={text.barChipLabel}
          className="shrink-0 rounded-lg bg-selected-chip-bg px-2.5 py-1 text-sm font-semibold text-selected-chip-text"
        >
          {text.barChip(barWithPass(names.label(bar), passIndex))}
        </span>
      )}
      {movedCount > 0 && (
        <span
          aria-label={text.movedChipLabel}
          className="shrink-0 rounded-lg bg-moved-bg px-2.5 py-1 text-sm font-semibold text-moved-text"
        >
          {text.movedChip(movedCount)}
        </span>
      )}
      {(unavailable || refusal !== null) && (
        <p role="status" className="min-w-0 text-sm text-text-soft">
          {unavailable ? text.noRecording : refusal}
        </p>
      )}
    </div>
  )
}
