import { ChevronDown, ChevronUp, Metronome, SkipBack, Volume2, VolumeX } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { Switch } from '@/components/ui/switch'
import { formatDuration } from '@/domain/pieceStatus'
import { loopTimes, playProgress, type LoopRange } from '@/domain/practice'
import { COUNT_IN_BAR_CHOICES, type CountInTempoSource, type SlotTiming } from '@/domain/tempo'
import { CLICK_TONES, type CountInBars } from '@/domain/types'
import { type PlaybackSettings } from '@/lib/dataClient'
import { useBarNames } from '@/lib/barNamesContext'
import { type PracticeControls, type PracticeState } from '@/lib/usePractice'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import { PlaybackMenu } from './PlaybackMenu'
import { PlayRing } from './PlayRing'
import { RangeField } from './RangeField'
import { SpeedMenu } from './SpeedMenu'
import { MenuChoice, toolbarButtonClass, ToolbarMenu } from './ToolbarMenu'
import { usePhoneLayout } from './usePhoneLayout'

const text = strings.practice

const TEMPO_SOURCES: readonly CountInTempoSource[] = ['loop-first-bar', 'bar-before']

export interface PracticeToolbarProps {
  state: PracticeState
  controls: PracticeControls
  timeline: SlotTiming[]
  /** The bar the cursor is in; null outside the map. */
  currentBar: number | null
  durationSec: number | null
  parts: { id: string; name: string }[]
  partId: string
  onPartChange(partId: string): void
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
  onRangeChange(range: LoopRange | null): void
  /** The Playback panel: the settings shown, the change handler (saves at once), and whether the last save failed. */
  playback: PlaybackSettings
  onPlaybackChange(update: Partial<PlaybackSettings>): void
  playbackFailed: boolean
  /** The overview strip, which on a phone folds away with the controls. */
  strip?: ReactNode
}

const countInLabel = (bars: CountInBars) => (bars === 0 ? text.countInOff : text.countInBars(bars))

/**
 * The card at the foot of Practice (board: Practice.png): restart, the play ring, the loop field, where the cursor is,
 * the metronome with its tone, the music volume, the speed, the count-in, Playback (the fade and the count on the score),
 * the part and, not yet working, Stems. It can
 * be folded down to its handle, which leaves the whole screen to the score. On a phone the handle folds all but the player,
 * the loop and the speed.
 */
export function PracticeToolbar({ state, controls, timeline, currentBar, durationSec, parts, partId, onPartChange, collapsed, onCollapsedChange, onRangeChange, playback, onPlaybackChange, playbackFailed, strip }: PracticeToolbarProps) {
  const phone = usePhoneLayout()
  const names = useBarNames()
  const partName = parts.find((part) => part.id === partId)?.name ?? ''
  const loopCountInId = useId()
  // Switching the count-in off keeps its length for switching it on again.
  const lastCountInBars = useRef<CountInBars>(state.countInBars === 0 ? 1 : state.countInBars)
  useEffect(() => {
    if (state.countInBars > 0) lastCountInBars.current = state.countInBars
  }, [state.countInBars])
  const progress = playProgress(state.timeSec, state.range === null ? null : loopTimes(timeline, state.range), durationSec)

  const restart = (
    <button
      type="button"
      aria-label={text.restart}
      onClick={controls.restartLoop}
      className={cn(toolbarButtonClass, 'size-11 justify-center px-0')}
    >
      <SkipBack className="size-5" aria-hidden="true" />
    </button>
  )
  const ring = <PlayRing state={state} progress={progress} size={phone ? 'compact' : 'responsive'} onToggle={controls.playPause} />
  const range = <RangeField timeline={timeline} range={state.range} looping={state.looping} onChange={onRangeChange} onToggleLooping={controls.setLooping} />
  const position = (
    <div className={phone ? 'ms-auto text-end' : 'ms-auto text-end lg:ms-0 lg:min-w-24'} data-slot="position">
      <p className={phone ? 'text-xl leading-[1.1] font-bold tracking-[-0.01em]' : 'text-[28px] leading-[1.1] font-bold tracking-[-0.01em] lg:text-xl'}>{currentBar === null ? text.noBar : text.bar(names.label(currentBar))}</p>
      <p className="text-sm text-text-muted tabular-nums">{text.time(formatDuration(state.timeSec), formatDuration(durationSec))}</p>
    </div>
  )
  const metronome = (
    <div className={cn(toolbarButtonClass, 'justify-between gap-3 ps-4 pe-3')} data-slot="metronome">
      <Metronome className="size-5 text-text-soft" aria-hidden="true" />
      <span>{text.metronome}</span>
      <Switch
        aria-label={text.metronomeSwitch}
        checked={state.metronome.on}
        onCheckedChange={(on) => controls.setMetronome({ on })}
      />
    </div>
  )
  const tone = (
    <ToolbarMenu label={text.tone(text.tones[state.metronome.tone])} panelLabel={text.toneMenu} panelRole="dialog" chevron={false} className="w-auto" panelClassName="min-w-64 gap-2 p-3">
      <div role="radiogroup" aria-label={text.toneMenu} className="flex flex-col">
        {CLICK_TONES.map((tone) => (
          <MenuChoice key={tone} role="radio" checked={tone === state.metronome.tone} onChoose={() => controls.setMetronome({ tone })}>
            {text.tones[tone]}
          </MenuChoice>
        ))}
      </div>
      <label className="flex min-h-11 items-center gap-3 px-3 text-[15px]">
        <Metronome className="size-5 shrink-0 text-text-soft" aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.metronome.volume}
          aria-label={text.metronomeVolume}
          onChange={(event) => controls.setMetronome({ volume: Number(event.target.value) })}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-primary-strong"
        />
      </label>
    </ToolbarMenu>
  )
  const volume = (
    <div className={cn(toolbarButtonClass, 'min-w-48 flex-1 gap-3')}>
      <button
        type="button"
        aria-label={state.muted ? text.unmuteMusic : text.muteMusic}
        aria-pressed={state.muted}
        onClick={() => controls.setMuted(!state.muted)}
        className={cn(
          '-ms-3 flex size-11 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          state.muted ? 'bg-danger-bright/12 text-danger-bright' : 'text-text-soft hover:bg-surface-3',
        )}
      >
        {state.muted ? <VolumeX className="size-5" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={state.musicVolume}
        aria-label={text.musicVolume}
        onChange={(event) => controls.setMusicVolume(Number(event.target.value))}
        className={cn('h-11 min-w-0 flex-1 cursor-pointer accent-primary-strong', state.muted && 'opacity-35')}
      />
    </div>
  )
  const speed = <SpeedMenu state={state} controls={controls} />
  const countIn = (
    <ToolbarMenu
      label={text.countIn(countInLabel(state.countInBars))}
      toggle={{
        pressed: state.countInBars > 0,
        onToggle: () => controls.setCountInBars(state.countInBars > 0 ? 0 : lastCountInBars.current),
        arrowLabel: text.countInSettings,
      }}
      panelLabel={text.countInMenu}
      panelRole="dialog"
      className="w-auto"
      panelClassName="min-w-64 gap-3 p-3">
      <div className="flex items-center gap-2.5 px-3">
        <div role="radiogroup" aria-label={text.countInBarsGroup} className="inline-flex rounded-lg border border-border bg-background p-0.5">
          {COUNT_IN_BAR_CHOICES.filter((bars) => bars > 0).map((bars) => (
            <button
              key={bars}
              type="button"
              role="radio"
              aria-checked={bars === state.countInBars}
              aria-label={text.countInBars(bars)}
              onClick={() => controls.setCountInBars(bars)}
              className={cn(
                'h-10 w-11 rounded-[0.6rem] text-[15px] font-semibold tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                bars === state.countInBars ? 'bg-primary text-on-primary' : 'text-text hover:bg-surface-2',
              )}
            >
              {bars}
            </button>
          ))}
        </div>
        <span aria-hidden="true" className="text-[15px] text-text-soft">
          {text.countInBarsWord}
        </span>
      </div>
      <label className="flex min-h-11 items-center justify-between gap-4 px-3 text-[15px]">
        {text.showCount}
        <Switch aria-label={text.showCount} checked={playback.showCount} onCheckedChange={(showCount) => onPlaybackChange({ showCount })} />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-4 px-3 text-[15px]">
        {text.countInMetronome}
        <Switch aria-label={text.countInMetronome} checked={state.countInMetronome} onCheckedChange={controls.setCountInMetronome} />
      </label>
      {playbackFailed && (
        <p role="alert" className="px-3 text-[15px] text-problem">
          {text.saveFailed}
        </p>
      )}
      <div role="group" aria-labelledby={loopCountInId} className="flex flex-col gap-1 border-t border-border pt-2">
        <p id={loopCountInId} className="px-3 text-sm font-medium text-text-soft">
          {text.loopCountIn}
        </p>
        <div role="radiogroup" aria-label={text.tempoSource} className="flex flex-col">
          {TEMPO_SOURCES.map((source) => (
            <MenuChoice key={source} role="radio" checked={source === state.tempoSource} onChoose={() => controls.setTempoSource(source)}>
              {text.tempoSources[source]}
            </MenuChoice>
          ))}
        </div>
        <label className="flex min-h-11 items-center justify-between gap-4 px-3 text-[15px]">
          {text.countInEveryRepeat}
          <Switch checked={state.countInEveryRepeat} onCheckedChange={controls.setCountInEveryRepeat} />
        </label>
      </div>
    </ToolbarMenu>
  )
  const playbackMenu = <PlaybackMenu playback={playback} onChange={onPlaybackChange} failed={playbackFailed} />
  const part = (
    <div className="min-w-48 flex-1">
      <ToolbarMenu label={<span className="truncate">{partName}</span>} panelLabel={text.partMenu} className="justify-between">
        {(close) =>
          parts.map((part) => (
            <MenuChoice
              key={part.id}
              checked={part.id === partId}
              onChoose={() => {
                close()
                onPartChange(part.id)
              }}
            >
              {part.name}
            </MenuChoice>
          ))
        }
      </ToolbarMenu>
    </div>
  )
  const stems = (
    <button
      type="button"
      disabled
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 text-[15px] text-text-muted dark:opacity-70"
    >
      {text.stems}
      <span className="rounded-full bg-loop-tint px-2 py-0.5 text-xs font-semibold text-loop-soft">{text.soon}</span>
    </button>
  )

  // On a phone Play, the loop and the speed stay on the screen; the handle folds only the rest, which opens over the score so
  // the score keeps its size. The loop and the speed take a second row when the phone is upright.
  if (phone) {
    return (
      <section aria-label={text.toolbar} data-slot="practice-toolbar" className="relative shrink-0 rounded-card border border-border bg-surface p-2">
        {!collapsed && (
          <div data-slot="practice-more" className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-[calc(100dvh-11rem)] flex-col gap-3 overflow-y-auto rounded-card border border-border bg-surface p-3 shadow-lg">
            {strip}
            <div className="flex flex-wrap items-center gap-2">
              {metronome}
              {tone}
            </div>
            {volume}
            <div className="flex flex-wrap items-center gap-2">
              {countIn}
              {playbackMenu}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {part}
              {stems}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {restart}
          {ring}
          <div className="order-last flex w-full items-center gap-2 landscape:order-none landscape:w-auto">
            {range}
            {speed}
          </div>
          {position}
          <button
            type="button"
            aria-label={collapsed ? text.moreControls : text.fewerControls}
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-text-soft outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {collapsed ? <ChevronUp className="size-5" aria-hidden="true" /> : <ChevronDown className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section aria-label={text.toolbar} data-slot="practice-toolbar" className="relative shrink-0 rounded-card border border-border bg-surface px-4 pb-4 lg:min-h-14 lg:py-3 lg:pe-16">
      <button
        type="button"
        aria-label={collapsed ? text.expand : text.collapse}
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
        className="mx-auto flex h-11 w-24 items-center justify-center rounded-lg text-text-soft outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 lg:absolute lg:end-3 lg:top-3 lg:mx-0 lg:w-11"
      >
        {collapsed ? <ChevronUp className="size-5" aria-hidden="true" /> : <ChevronDown className="size-5" aria-hidden="true" />}
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 lg:contents">
            {restart}
            {ring}
            {range}
            {position}
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:contents">
            {metronome}
            {tone}
            {volume}
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:contents">
            {speed}
            {countIn}
            {playbackMenu}
            {part}
            {stems}
          </div>
        </div>
      )}
    </section>
  )
}
