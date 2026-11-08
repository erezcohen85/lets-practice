import { restLabels } from '@/domain/restLabels'
import { type BarBox, type BarNumber } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

/** How a bar is drawn on the page. 'moved': its bar line was dragged by hand and is not resolved yet. 'rest': a rest bar of the part, faintly filled (Editor only). */
export type BarState = 'plain' | 'unmatched' | 'selected' | 'moved' | 'rest'

// Complete class names, so Tailwind finds them. The page is paper, so only the on-paper tokens are used: ink at a low
// alpha for the outlines, the paper cursor for the selected bar.
const BOX_CLASS: Record<BarState, string> = {
  plain: 'border border-ink/15',
  unmatched: 'border border-dashed border-ink/30',
  selected: 'border-2 border-paper-selected bg-paper-selected/15',
  moved: 'border-2 border-paper-moved bg-paper-moved/15',
  rest: 'border border-ink/15 bg-ink/5',
}

/**
 * One box per bar on top of a page image, at the image rectangle times `scale`. Does not take the pointer: the page
 * under it does, so the Edit sheet hit-tests in image pixels. Lives inside the score's left-to-right container, which is
 * why the positions are inline left / top. The box hugs the staff, so its labels (the bar number, the moved mark, the
 * unmatched dot) sit just above it and the tag just below, on the paper, clear of the staff lines. The bars of a
 * multi-bar rest share one box, so the first of them carries one range label ("18–28") and the others draw none.
 */
export function BarOverlay({
  boxes,
  barStates,
  barTags,
  selectedBar = null,
  scale,
  showNumbers = true,
}: {
  boxes: readonly BarBox[]
  barStates: ReadonlyMap<BarNumber, BarState>
  /** A short line drawn at the foot of a bar ("Bar 41 moved +0.42 s"). */
  barTags?: ReadonlyMap<BarNumber, string>
  /** The selected bar: when it is also a moved bar it keeps the moved tint and gets the selected outline over it. */
  selectedBar?: BarNumber | null
  scale: number
  /** False draws no bar numbers and no rest ranges (Settings > Bar numbers over the staff); the boxes stay. Default true. */
  showNumbers?: boolean
}) {
  const names = useBarNames()
  const labels = showNumbers ? restLabels(boxes, names) : new Map<BarNumber, string>()
  return (
    <div data-slot="bar-overlay" className="pointer-events-none absolute inset-0">
      {boxes.map((box) => {
        const state = barStates.get(box.bar) ?? 'plain'
        const tag = barTags?.get(box.bar)
        return (
          <div
            key={box.bar}
            data-slot="bar-box"
            data-bar={box.bar}
            data-state={state}
            className={cn('absolute box-border', BOX_CLASS[state], state === 'moved' && box.bar === selectedBar && 'border-paper-selected')}
            style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
          >
            {labels.has(box.bar) && (
              <span data-slot="bar-number" className="absolute start-0.5 bottom-full mb-px text-[11px] leading-none font-medium text-ink">
                {labels.get(box.bar)}
              </span>
            )}
            {state === 'moved' && (
              <span data-slot="bar-moved-mark" role="img" aria-label={strings.score.moved} className="absolute end-0.5 bottom-full mb-px text-[11px] leading-none font-bold text-paper-moved">
                ⇔
              </span>
            )}
            {tag !== undefined && (
              <span data-slot="bar-tag" className="absolute start-0.5 top-full mt-0.5 rounded-sm bg-ink px-1 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap text-paper">
                {tag}
              </span>
            )}
            {state === 'unmatched' && (
              <span
                data-slot="bar-dot"
                role="img"
                aria-label={strings.score.unmatched}
                className="absolute end-1 bottom-full mb-0.5 size-1.5 rounded-full bg-ink/50"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
