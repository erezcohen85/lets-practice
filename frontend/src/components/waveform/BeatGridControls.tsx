import { Menu } from '@base-ui/react/menu'
import { Check, ChevronDown, ChevronsRight, Columns2, Columns4 } from 'lucide-react'
import { memo, useEffect, useId, useMemo, useState } from 'react'
import { ConfirmQuestion } from '@/components/hub/ConfirmQuestion'
import { Button, buttonVariants } from '@/components/ui/button'
import { Hint } from '@/components/ui/hint'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type DockLocator } from '@/components/waveform/dockLayout'
import { continueEdit, type RegridEdit } from '@/components/waveform/regridEdit'
import { BEATS_PER_BAR_CHOICES, cleanBeats, measuredBeatsPerBar, type BeatsPerBar } from '@/domain/beatGrid'
import { type DetectedBeat } from '@/domain/beats'
import { type EditorDoc, type EditRefusal } from '@/domain/pieceEdits'
import { planContinue, planContinueOrWhy, planRegrid, type ContinueOff, type ContinueResult, type RegridPlan, type RegridStretch } from '@/domain/regridEdits'
import { doubleTimeBeats, halfTimeBeats, measureScales, pickStretch } from '@/domain/regridStretch'
import { type TimingLayer } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.dock.grid

export type { RegridEdit }

type Control = 'continue' | 'half' | 'double' | BeatsPerBar

/** What one control does now: whether it is on, what its hover text says, the lines it would put (for the preview) and the edit it sends. */
interface Option {
  enabled: boolean
  hint: string
  plan: RegridPlan | null
  edit: RegridEdit | null
}

/**
 * A control that is off says so with aria-disabled and stays a control: it keeps its place in the tab order and the focus it has
 * (a native `disabled` would drop the focus to the page when pressing a control turns it off), and `press` ignores it. The
 * pointer goes through to the hover text around it.
 */
const OFF = 'aria-disabled:pointer-events-none aria-disabled:opacity-50'

const changes = (plan: RegridPlan): boolean => plan.adds.length > 0 || plan.deletes.length > 0
const off = (hint: string): Option => ({ enabled: false, hint, plan: null, edit: null })

export interface BeatGridControlsProps {
  timing: TimingLayer
  /** Every bar line of the piece, in play order. */
  lines: readonly DockLocator[]
  /** The selected bar lines; none selected means the whole piece. */
  selection: readonly { bar: number; passIndex: number }[]
  beats: readonly DetectedBeat[] | null
  durationSec: number
  /** The dock can edit; without it the controls are off. */
  editing: boolean
  onEdit(edit: RegridEdit): EditRefusal | null
  /** The lines the control under the pointer would put on the waveform and the guesses it would move or remove; null when none. */
  onPreview(plan: RegridPlan | null): void
}

/** Why Continue is off when there is no plan to go on with: the sentence for each reason. */
function continueOffText(why: ContinueOff, selectedWrongLine: boolean): string {
  if (why === 'not-steady') return text.notSteady
  if (why === 'no-room') return text.noRoom
  return selectedWrongLine ? text.continueElsewhere : text.nothingToLearn
}

/** Continue as a control: off when no run of checked lines can be learned from, or when going on from it would change nothing. */
function continueOption(continued: ContinueResult, beats: readonly DetectedBeat[], selectedWrongLine: boolean, label: (bar: number) => string): Option {
  const learned = continued.plan
  if (learned === null) return off(continueOffText(continued.off, selectedWrongLine))
  if (!changes(learned.plan)) return off(text.nothingChanges)
  const edit = continueEdit(learned, beats, label)
  return { enabled: true, hint: text.continueOn(edit.continuedFrom!.first, edit.continuedFrom!.last), plan: learned.plan, edit }
}

/**
 * The group after Snap in the dock's toolbar: Continue, Half-time, Double-time and the beats a bar (1 to 6). Each control says
 * in its hover text what it does, or why it is off; while the pointer (or the keyboard) is on one, `onPreview` shows what it
 * would put on the waveform. With nothing selected the whole piece would change, so it asks first.
 */
export const BeatGridControls = memo(function BeatGridControls({ timing, lines, selection, beats, durationSec, editing, onEdit, onPreview }: BeatGridControlsProps) {
  const names = useBarNames()
  const [rest, setRest] = useState<Control | null>(null)
  const [pending, setPending] = useState<RegridEdit | null>(null)

  const hasBeats = beats !== null && beats.length >= 2
  const grid = useMemo(() => cleanBeats((beats ?? []).map((beat) => beat.t)), [beats])
  const doc = useMemo<EditorDoc>(() => ({ timing, pages: [] }), [timing])
  const pick = useMemo(() => pickStretch(lines, selection, durationSec), [lines, selection, durationSec])
  // The beats a bar are counted in bars of the meter of the stretch's first bar: a bar of another meter counts by its felt beats.
  const measured = useMemo(
    () => (pick.ok ? measuredBeatsPerBar(grid, pick.lineTimes, measureScales(lines, pick.fromSec, pick.toSec, timing.meters)) : null),
    [pick, grid, lines, timing.meters],
  )

  // One plan for each number of beats a bar over the picked stretch: the segments, Half-time and Double-time use them.
  const plans = useMemo(() => {
    if (!hasBeats || !pick.ok) return null
    const stretch: RegridStretch = { fromSec: pick.fromSec, toSec: pick.toSec, fit: 'ripple' }
    return Object.fromEntries(BEATS_PER_BAR_CHOICES.map((n) => [n, { stretch, plan: planRegrid(doc, stretch, beats, n) }])) as Record<BeatsPerBar, { stretch: RegridStretch; plan: RegridPlan }>
  }, [hasBeats, pick, doc, beats])

  // Continue goes on from the last selected line; with nothing selected, from the latest run of checked lines.
  const from = pick.ok && pick.lastSlot !== null ? pick.lastSlot : undefined
  const continued = useMemo(() => (hasBeats ? planContinueOrWhy(doc, beats, durationSec, from) : null), [hasBeats, doc, beats, durationSec, from])
  const learned = continued?.plan ?? null
  const continuing = useMemo<Option>(() => {
    if (!hasBeats || continued === null) return off(text.noBeats)
    if (!pick.ok && pick.reason === 'selection-without-line') return off(text.selectionNoLine)
    // A line is selected that no run of checked lines ends at, though one exists elsewhere.
    const selectedWrongLine = continued.off === 'no-run' && from !== undefined && planContinue(doc, beats, durationSec) !== null
    return continueOption(continued, beats, selectedWrongLine, (bar) => names.label(bar))
  }, [hasBeats, pick, continued, from, doc, beats, durationSec, names])

  const options = useMemo<Record<Control, Option>>(() => {
    // Why every number-of-beats control is off when there is nothing to work on.
    const blocked = !hasBeats
      ? text.noBeats
      : !pick.ok
        ? { 'no-lines': text.noLines, 'selection-without-line': text.selectionNoLine, 'no-room': text.noRoom }[pick.reason]
        : null
    const beatsOption = (n: BeatsPerBar, hint: (n: BeatsPerBar) => string): Option => {
      if (blocked !== null || plans === null) return off(blocked ?? text.noBeats)
      const { stretch, plan } = plans[n]
      if (!changes(plan)) return off(text.nothingChanges)
      return { enabled: true, hint: hint(n), plan, edit: { kind: 'regrid', stretch, beats: beats ?? [], beatsPerBar: n, offsetSec: 0, continuedFrom: null } }
    }
    const relative = (target: BeatsPerBar | null, hint: (n: BeatsPerBar, now: BeatsPerBar) => string, impossible: (now: BeatsPerBar) => string): Option => {
      if (blocked !== null) return off(blocked)
      if (measured === null) return off(text.cannotMeasure)
      if (target === null) return off(impossible(measured))
      return beatsOption(target, (n) => hint(n, measured))
    }
    const numbered = Object.fromEntries(BEATS_PER_BAR_CHOICES.map((n) => [n, beatsOption(n, text.beatsOn)])) as Record<BeatsPerBar, Option>
    return {
      continue: continuing,
      half: relative(measured === null ? null : halfTimeBeats(measured), text.halfTimeOn, text.halfTimeTooMany),
      double: relative(measured === null ? null : doubleTimeBeats(measured), text.doubleTimeOn, (now) => (now === 1 ? text.doubleTimeTooFew : text.doubleTimeNotWhole(now))),
      ...numbered,
    }
  }, [hasBeats, pick, plans, measured, continuing, beats])

  const enabled = (control: Control): boolean => editing && options[control].enabled
  const hintFor = (control: Control, name: string): string => (editing ? options[control].hint : name)

  // The control under the pointer (or the keyboard) shows its plan on the waveform.
  const previewed = rest !== null && enabled(rest) ? options[rest].plan : null
  useEffect(() => {
    onPreview(previewed)
    return () => onPreview(null)
  }, [previewed, onPreview])

  const press = (control: Control) => {
    const edit = options[control].edit
    if (!enabled(control) || edit === null) return
    setRest(null)
    // Nothing selected: the whole piece, which is asked before it is changed. Continue has a stretch of its own.
    if (control !== 'continue' && pick.ok && pick.whole) setPending(edit)
    else onEdit(edit)
  }
  const resting = (control: Control) => ({
    onPointerEnter: () => setRest(control),
    onPointerLeave: () => setRest(null),
    onFocus: () => setRest(control),
    onBlur: () => setRest(null),
  })

  // The segment pressed is the beats a bar the stretch has now; where that cannot be told, the pulse Continue would go on with.
  const pressed = measured ?? learned?.beatsPerBar ?? null
  const ariaOff = (control: Control): true | undefined => (enabled(control) ? undefined : true)

  // The menu of the same choices (below 1700 px): a row names the choice and, when it is off, says why on a second line.
  const menuId = useId()
  const row = (control: Control, title: string) => {
    const unavailable = !enabled(control)
    const titleId = `${menuId}-${control}`
    const reasonId = `${titleId}-why`
    return {
      props: {
        'aria-disabled': ariaOff(control),
        'aria-labelledby': titleId,
        'aria-describedby': unavailable ? reasonId : undefined,
        // an item that does nothing leaves the menu open, so its reason can be read
        closeOnClick: !unavailable,
        onClick: () => press(control),
        ...resting(control),
      },
      content: (
        <>
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            {typeof control === 'number' && (
              <Menu.RadioItemIndicator>
                <Check className="size-4" />
              </Menu.RadioItemIndicator>
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span id={titleId} className={unavailable ? 'text-text-soft' : 'text-text'}>
              {title}
            </span>
            {unavailable && (
              <span id={reasonId} className="text-xs font-normal whitespace-normal text-text-soft">
                {options[control].hint}
              </span>
            )}
          </span>
        </>
      ),
    }
  }
  const ROW = 'flex min-h-11 cursor-default items-center gap-2.5 rounded-(--lp-radius-sm) px-3 py-1.5 text-[15px] font-medium outline-none select-none data-highlighted:bg-surface-3 aria-disabled:cursor-not-allowed'
  const half = row('half', text.halfTime)
  const double = row('double', text.doubleTime)

  return (
    <>
      <div role="group" aria-label={text.group} className="flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap">
        <Hint text={hintFor('continue', text.continue)}>
          <Button variant="outline" size="sm" aria-disabled={ariaOff('continue')} className={OFF} onClick={() => press('continue')} {...resting('continue')}>
            <ChevronsRight aria-hidden />
            {text.continue}
          </Button>
        </Hint>

        {/* Below 1700 px the rest of the group is one button that opens a menu: the toolbar has no room for six. */}
        <Menu.Root modal={false} onOpenChange={(open) => !open && setRest(null)}>
          <Hint text={editing ? text.beatsMenuHint : text.beatsMenu} className="min-[1700px]:hidden">
            <Menu.Trigger disabled={!editing} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'data-popup-open:bg-muted')}>
              {text.beatsMenu}
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </Menu.Trigger>
          </Hint>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
              <Menu.Popup className="flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-0.5 rounded-lg border border-border-strong bg-surface-2 p-1.5 shadow-[0_12px_32px_color-mix(in_oklab,var(--lp-ink)_45%,transparent)] outline-none">
                <Menu.Item {...half.props} className={ROW}>
                  {half.content}
                </Menu.Item>
                <Menu.Item {...double.props} className={ROW}>
                  {double.content}
                </Menu.Item>
                <Menu.RadioGroup value={pressed === null ? '' : String(pressed)} className="flex flex-col gap-0.5">
                  {BEATS_PER_BAR_CHOICES.map((n) => {
                    const beatsRow = row(n, text.beatsABar(n))
                    return (
                      <Menu.RadioItem key={n} value={String(n)} {...beatsRow.props} className={ROW}>
                        {beatsRow.content}
                      </Menu.RadioItem>
                    )
                  })}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        {/* From 1700 px the buttons and the segments. */}
        <div className="hidden items-center gap-1 min-[1700px]:flex">
          <Hint text={hintFor('half', text.halfTime)}>
            <Button variant="outline" size="icon-sm" aria-label={text.halfTime} aria-disabled={ariaOff('half')} className={OFF} onClick={() => press('half')} {...resting('half')}>
              <Columns2 aria-hidden />
            </Button>
          </Hint>
          <Hint text={hintFor('double', text.doubleTime)}>
            <Button variant="outline" size="icon-sm" aria-label={text.doubleTime} aria-disabled={ariaOff('double')} className={OFF} onClick={() => press('double')} {...resting('double')}>
              <Columns4 aria-hidden />
            </Button>
          </Hint>
          <span className="ms-1 text-sm text-text-soft">{text.beatsABarWord}</span>
          <ToggleGroup aria-label={text.beatsABarWord} variant="outline" size="sm" spacing={1} value={pressed === null ? [] : [String(pressed)]}>
            {BEATS_PER_BAR_CHOICES.map((n) => (
              <Hint key={n} text={hintFor(n, text.beatsABar(n))}>
                <ToggleGroupItem
                  value={String(n)}
                  aria-label={text.beatsABar(n)}
                  aria-disabled={ariaOff(n)}
                  onClick={() => press(n)}
                  className={cn(
                    'min-w-6 px-1.5',
                    // The pressed one is filled like the Locators filter's selected button (primary and its label colour) and bold, so it reads by more than its hue.
                    'aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:font-bold aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/80 aria-pressed:hover:text-primary-foreground',
                    // An off one fades; the pressed one says what the stretch has now, so it never does.
                    OFF,
                    'aria-pressed:aria-disabled:opacity-100',
                  )}
                  {...resting(n)}
                >
                  {n}
                </ToggleGroupItem>
              </Hint>
            ))}
          </ToggleGroup>
        </div>
      </div>
      <ConfirmQuestion
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={text.wholeTitle}
        description={text.wholeText}
        confirmLabel={text.wholeConfirm}
        cancelLabel={text.wholeCancel}
        failedText={text.wholeFailed}
        onConfirm={async () => {
          if (pending !== null) onEdit(pending)
        }}
      />
    </>
  )
})
