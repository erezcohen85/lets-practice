import { useId } from 'react'
import { type PracticeControls, type PracticeState } from '@/lib/usePractice'
import { strings } from '@/strings'
import { ToolbarMenu } from './ToolbarMenu'

const text = strings.practice

/**
 * The speed button of the toolbar and its panel (board: Practice.png): the speed as a big number over a slider from a quarter
 * to double speed, and a button back to normal. A drag changes the speed while it moves; a click count-in that the drag
 * left behind counts in again once the finger lifts. The panel stays open until the button is pressed again.
 */
export function SpeedMenu({ state, controls }: { state: PracticeState; controls: Pick<PracticeControls, 'setSpeed' | 'commitSpeed'> }) {
  const sliderId = useId()
  const { min, max, step } = state.speedRange
  // Where normal speed sits on the slider, for its mark.
  const normalAt = `${((1 - min) / (max - min)) * 100}%`
  return (
    <ToolbarMenu
      label={strings.player.speed(state.speed)}
      panelLabel={strings.player.speedLabel}
      panelRole="dialog"
      className="w-auto border-primary-strong/60 text-primary-strong"
      panelClassName="w-[300px] max-w-[calc(100vw-2rem)] gap-3 p-4 shadow-[0_12px_32px_color-mix(in_oklab,var(--lp-ink)_45%,transparent)]"
    >
      <>
          <div className="flex items-baseline justify-between">
            <label htmlFor={sliderId} className="text-sm font-semibold tracking-[0.04em] text-text-soft uppercase">
              {text.speedHeading}
            </label>
            <span aria-hidden="true" className="text-2xl leading-8 font-bold text-primary-strong tabular-nums">
              {strings.player.speed(state.speed)}
            </span>
          </div>
          <input
            id={sliderId}
            type="range"
            min={min}
            max={max}
            step={step}
            value={state.speed}
            aria-valuetext={text.speedValueText(state.speed)}
            onChange={(event) => controls.setSpeed(Number(event.target.value), { live: true })}
            onPointerUp={controls.commitSpeed}
            onPointerCancel={controls.commitSpeed}
            onKeyUp={controls.commitSpeed}
            onBlur={controls.commitSpeed}
            className="h-11 w-full cursor-pointer accent-primary-strong"
          />
          <div aria-hidden="true" className="relative -mt-2 h-4 text-xs text-text-muted">
            <span className="absolute start-0">{strings.player.speed(min)}</span>
            <span className="absolute -translate-x-1/2" style={{ left: normalAt }}>
              {strings.player.speed(1)}
            </span>
            <span className="absolute end-0">{strings.player.speed(max)}</span>
          </div>
          <button
            type="button"
            onClick={() => controls.setSpeed(1)}
            className="-ms-3 inline-flex min-h-11 items-center self-start rounded-lg px-3 text-sm font-medium text-primary-strong outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {text.backToNormalSpeed}
          </button>
      </>
    </ToolbarMenu>
  )
}
