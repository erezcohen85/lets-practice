import { fadeLevel, planCountInFade, type CountInFade, type FadeSpan } from '@/domain/countInFade'
import { clicksBetween, loopTimes, nextLoop as nextLoopRange, type LoopRange } from '@/domain/practice'
import {
  beatTimes,
  localTempo,
  planCountIn,
  slotIndexAt,
  SPEED_RANGE,
  snapSpeed,
  type CountInPlan,
  type CountInTempoSource,
  type SlotTiming,
} from '@/domain/tempo'
import { CLICK_TONES, type ClickTone, type CountInBars, type ListedMark, type PracticeMemory } from '@/domain/types'
import { type ClickSynth } from '@/lib/audio/clickSynth'
import { type DataClient } from '@/lib/dataClient'
import { type Player, type PlayerEvent } from '@/lib/player/player'

// The loop engine behind usePractice: the player, the click synth and the saved memory, with no React in it. It keeps
// every time in recording time (spec 5.5); the speed only turns recording seconds into wall seconds for the clicks.

/** How far ahead of the cursor, in recording seconds, the metronome hands clicks to the synth. */
const LOOKAHEAD_SEC = 0.2
/** The wall time between two frames is clamped to this, so one slow frame does not wrap far too early. */
const MIN_FRAME_SEC = 0.008
const MAX_FRAME_SEC = 0.05
/** The frame length assumed before two frames have been seen. */
const FIRST_FRAME_SEC = 0.016
/** A time this close before the loop start still counts as inside it: a media element reads a seek back a hair early. */
const RANGE_SLACK_SEC = 0.05
/** A seek this close to the one the engine asked for is its own, not the player's. */
const OWN_SEEK_SLACK_SEC = 0.25
/** At most one save of the practice memory in this many milliseconds of changes. */
const SAVE_INTERVAL_MS = 500

export interface PracticeState {
  phase: 'idle' | 'counting' | 'playing' | 'paused'
  timeSec: number
  range: LoopRange | null
  /** The range repeats while playing; false after a single tap plays on from a bar. */
  looping: boolean
  /** The visual count during a count-in. */
  count: { beat: number; of: number } | null
  /** The play-order position of the bar a count-in leads into (a loop's first bar, or the bar at the playhead); null outside a count-in. */
  countAt: number | null
  speed: number
  /** The speeds the slider offers: from `min` to `max` in steps of `step`. */
  speedRange: typeof SPEED_RANGE
  countInBars: CountInBars
  tempoSource: CountInTempoSource
  countInEveryRepeat: boolean
  countInMetronome: boolean
  /** bpm = the local tempo at the cursor × the speed; null outside the timeline. */
  metronome: { on: boolean; volume: number; tone: ClickTone; bpm: number | null }
  musicVolume: number
  /** The music is silenced for now; the volume above is kept. Not saved: a new visit opens unmuted. */
  muted: boolean
}

export interface PracticeControls {
  playPause(): void
  restartLoop(): void
  nextLoop(): void
  /** A new range resets the tempo source to 'loop-first-bar' (Decision 2026-10-26). The next Play starts it from its first bar, wherever the playhead is. */
  setRange(range: LoopRange | null): void
  /**
   * Play from the bar. Moving outside the range (this, or a seek of the player) turns looping off and keeps the range;
   * a bar inside it keeps looping as it is.
   */
  playFrom(position: number): void
  /** Puts the playhead at the start of the bar at `position` without starting anything: playing goes on from there, a pause stays a pause, a count-in stops. */
  selectBar(position: number): void
  /** Looping on seeks to the loop start (without playing or counting in; the next Play counts in); off keeps the range and plays on. No effect on on with no range. */
  setLooping(on: boolean): void
  /** Puts a loop back exactly as it was, range and on / off, with no seek and no count-in (a cancelled pick); a new range comes by setRange. */
  setLoop(range: LoopRange | null, looping: boolean): void
  /**
   * Any speed from 0.25 to 2, snapped to 0.05; another value is ignored. The rate changes at once. A click count-in under
   * way counts in again at the new speed right away, unless `live` (a drag of the slider): then it waits for commitSpeed().
   */
  setSpeed(rate: number, options?: { live?: boolean }): void
  /** The end of a drag of the speed: a click count-in that the drag left behind counts in again at the speed it ended on. */
  commitSpeed(): void
  setCountInBars(bars: CountInBars): void
  setTempoSource(source: CountInTempoSource): void
  setCountInEveryRepeat(on: boolean): void
  /** The metronome clicks during a count-in (a click count-in, or over the bars of a pre-roll), whatever the metronome switch says for the music. */
  setCountInMetronome(on: boolean): void
  setMetronome(change: Partial<PracticeState['metronome']>): void
  /** Silences the music (not the metronome or the count-in clicks) without changing the volume. */
  setMuted(on: boolean): void
  /** Moving the volume unmutes. */
  setMusicVolume(volume: number): void
}

export interface PracticeEngineInput {
  player: Player
  synth: ClickSynth
  data: Pick<DataClient, 'setCountInBars' | 'savePracticeMemory'>
  timeline: SlotTiming[]
  /** The fermatas of the timing and the rests of the part being practised (listedMarks); a count-in does not replay a bar that holds one. */
  marks: ListedMark[]
  pieceId: string
  initialCountInBars: CountInBars
  initialMemory: PracticeMemory
  /** Playback panel: how the recording fades in with a count-in; read at each start of a loop, so a change applies to the next one. */
  countInFade: CountInFade
}

export interface PracticeEngine {
  controls: PracticeControls
  getState(): PracticeState
  subscribe(listener: () => void): () => void
  /** The parts of the input that may change while the engine lives: the timeline, the marks, the data client and the fade. */
  update(change: Pick<PracticeEngineInput, 'timeline' | 'marks' | 'data' | 'countInFade'>): void
  /** Starts following the player; call again after stop(). */
  start(): void
  /** Stops the frames and the timers and saves what is unsaved. The player and the synth are not destroyed. */
  stop(): void
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function createPracticeEngine(input: PracticeEngineInput): PracticeEngine {
  const { player, synth, pieceId } = input
  let { data, timeline, marks, countInFade } = input
  const listeners = new Set<() => void>()

  let phase: PracticeState['phase'] = 'idle'
  let timeSec = 0
  let range: LoopRange | null =
    input.initialMemory.loop !== null && input.initialMemory.loop.endPosition < timeline.length ? { ...input.initialMemory.loop } : null
  let looping = range !== null && input.initialMemory.loopOn
  // What was last handed to the saver, so a change of looping alone (a move outside the loop) is saved too.
  let loopingSaved = looping
  let count: PracticeState['count'] = null
  let speed = input.initialMemory.speed
  let countInBars = input.initialCountInBars
  let tempoSource: CountInTempoSource = 'loop-first-bar'
  let countInEveryRepeat = input.initialMemory.countInEveryRepeat
  let countInMetronome = input.initialMemory.countInMetronome
  // Where the music proper starts after the count-in under way (a pre-roll ends when the recording gets there).
  let countTargetSec = 0
  let countPosition = 0
  let metronome = { ...input.initialMemory.metronome }
  let musicVolume = input.initialMemory.musicVolume
  // Mute is a flag on top of the volume, so the volume that is saved is never overwritten by it; it is not saved.
  let muted = false
  // A drag of the speed changed it during a click count-in: the count-in is planned again at the release.
  let speedRestartPending = false

  // Metronome: the recording times of the clicks already handed to the synth.
  const scheduled = new Set<number>()
  let frame: number | null = null
  // The wall time between the last two frames: the loop wraps one frame early so the next bar never sounds.
  let lastTickAt: number | null = null
  let frameSec = FIRST_FRAME_SEC

  // A count-in in progress: the pre-roll counts recorded beats, a click count-in counts wall time.
  let countMode: 'pre-roll' | 'click' | null = null
  let preRollBeats: number[] = []
  let clickBeatStarts: number[] = []
  let clickStartedAt = 0
  let clickTimer: ReturnType<typeof setTimeout> | null = null
  // The count-in fade in progress: the recording time it rises over, and whether the recording plays under the clicks.
  let fadeSpan: FadeSpan | null = null
  let ownSeekSec: number | null = null
  let underClicks = false
  let underClicksTimer: ReturnType<typeof setTimeout> | null = null
  // A pause during a count-in resumes by counting in again, a pause in the music by playing on; a loop just set starts from its first bar.
  let resumeAs: 'resume' | 'restart' = 'resume'

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  let saveCount = 0

  function build(): PracticeState {
    const index = slotIndexAt(timeline, timeSec)
    return {
      phase,
      timeSec,
      range,
      looping,
      count,
      countAt: count === null ? null : countPosition,
      speed,
      speedRange: SPEED_RANGE,
      countInBars,
      tempoSource,
      countInEveryRepeat,
      countInMetronome,
      metronome: { ...metronome, bpm: index === -1 ? null : localTempo(timeline[index]).bpm * speed },
      musicVolume,
      muted,
    }
  }

  let state = build()

  function publish(): void {
    if (looping !== loopingSaved) {
      loopingSaved = looping
      markDirty()
    }
    state = build()
    for (const listener of [...listeners]) listener()
  }

  // --- saving what the piece remembers --------------------------------------

  function memory(): PracticeMemory {
    return {
      metronome: { on: metronome.on, volume: metronome.volume, tone: metronome.tone },
      musicVolume,
      speed,
      loop: range === null ? null : { ...range },
      loopOn: looping,
      countInEveryRepeat,
      countInMetronome,
    }
  }

  function flushSave(): void {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = null
    if (!dirty) return
    dirty = false
    const mine = ++saveCount
    // A failed save keeps the values on screen and stays unsaved, so the next change tries again.
    data.savePracticeMemory(pieceId, memory()).catch(() => {
      if (mine === saveCount) dirty = true
    })
  }

  function markDirty(): void {
    dirty = true
    saveTimer ??= setTimeout(flushSave, SAVE_INTERVAL_MS)
  }

  // --- the metronome --------------------------------------------------------

  function stopClicks(): void {
    scheduled.clear()
    synth.cancelAll()
  }

  /** Hands the synth the clicks of the next LOOKAHEAD_SEC of recording time that it does not have yet. */
  function scheduleClicks(): void {
    // The bars of a pre-roll are clicked for the count-in when the user wants that, with the metronome off for the music.
    const countClicks = countMode === 'pre-roll' && countInMetronome
    if ((!metronome.on && !countClicks) || !player.isPlaying()) return
    const now = player.getTime()
    let until = now + LOOKAHEAD_SEC
    if (!metronome.on) until = Math.min(until, countTargetSec)
    // Nothing past the loop end: after the wrap the clicks come from the loop start.
    if (looping && range !== null) until = Math.min(until, loopTimes(timeline, range).endSec)
    for (const click of clicksBetween(timeline, now, until)) {
      if (scheduled.has(click.timeSec)) continue
      scheduled.add(click.timeSec)
      synth.schedule((click.timeSec - now) / speed, click.accent)
    }
    for (const time of scheduled) if (time < now - 1) scheduled.delete(time)
  }

  // --- playing --------------------------------------------------------------

  function playPlayer(): void {
    player.play().catch(() => {
      // A refused play leaves the player paused: show it.
      abortCount()
      stopClicks()
      phase = 'paused'
      publish()
    })
  }

  function abortCount(): void {
    if (clickTimer !== null) clearTimeout(clickTimer)
    clickTimer = null
    countMode = null
    count = null
    clearFade()
  }

  // --- the count-in fade ----------------------------------------------------

  /** Ends the fade and puts the music at the volume the toolbar sets. */
  function clearFade(): void {
    if (underClicksTimer !== null) clearTimeout(underClicksTimer)
    underClicksTimer = null
    fadeSpan = null
    ownSeekSec = null
    underClicks = false
    player.setFade(1)
  }

  /** The fade follows the recording's own time, so pausing, a slower speed and a late start all keep it true. */
  function updateFade(): void {
    if (fadeSpan === null) return
    if (player.getTime() >= fadeSpan.toSec) clearFade()
    else player.setFade(fadeLevel(fadeSpan, player.getTime()))
  }

  /** A seek the engine makes as part of a count-in; the player's 'seek' event for it must not cancel the fade. */
  function seekForCount(timeSec: number): void {
    ownSeekSec = timeSec
    player.seek(timeSec)
  }

  /** Starts the range from its first bar, with its count-in. */
  function startLoop(): void {
    if (range === null) return
    startAt(range.startPosition, loopTimes(timeline, range).startSec, true)
  }

  /**
   * Starts the music at the bar at `startPosition` (its start, `startSec`) with the count-in: a loop's first bar, or,
   * with no loop, the bar at the playhead (every Play counts in when the count-in is on; Erez, 2026-11-03).
   */
  function startAt(startPosition: number, startSec: number, loop: boolean): void {
    abortCount()
    stopClicks()
    looping = loop
    resumeAs = 'resume'
    countTargetSec = startSec
    countPosition = startPosition
    const plan: CountInPlan = planCountIn(timeline, marks, startPosition, { speed, tempoSource, bars: countInBars })
    const fadePlan = planCountInFade(
      countInFade,
      plan,
      { startPosition, startSec, firstBeatSec: localTempo(timeline[startPosition]).beatSec },
      speed,
    )
    fadeSpan = fadePlan.span

    if (plan.type === 'off') {
      phase = 'playing'
      player.seek(startSec)
      playPlayer()
    } else if (plan.type === 'pre-roll') {
      const slots = timeline.slice(startPosition - plan.bars.length, startPosition)
      preRollBeats = slots.flatMap(beatTimes)
      countMode = 'pre-roll'
      count = { beat: 1, of: plan.beats }
      phase = 'counting'
      seekForCount(plan.recordingStartSec)
      updateFade()
      playPlayer()
    } else {
      countMode = 'click'
      count = { beat: 1, of: plan.beats }
      phase = 'counting'
      const under = fadePlan.underClicks
      if (under === null) {
        seekForCount(startSec)
        updateFade()
      } else {
        underClicks = true
        seekForCount(under.startSec)
        updateFade()
        if (under.delayWallSec > 0) underClicksTimer = setTimeout(playPlayer, under.delayWallSec * 1000)
        else playPlayer()
      }
      let delaySec = 0
      clickBeatStarts = []
      for (const bar of plan.bars) {
        for (let beat = 0; beat < bar.beats; beat++) {
          clickBeatStarts.push(delaySec)
          if (countInMetronome) synth.schedule(delaySec, beat === 0)
          delaySec += bar.beatWallSec
        }
      }
      clickStartedAt = performance.now()
      clickTimer = setTimeout(finishClickCount, delaySec * 1000)
    }
    timeSec = player.getTime()
    publish()
    ensureFrames()
  }

  function finishClickCount(): void {
    clickTimer = null
    countMode = null
    count = null
    phase = 'playing'
    // Under the clicks the recording is already at the loop start: full volume from here, and no second play.
    if (underClicks) clearFade()
    playPlayer()
    publish()
    ensureFrames()
  }

  /** Back to the loop start at the loop end: seamless, or with the count-in again. */
  function wrap(): void {
    if (range === null) return
    if (countInEveryRepeat) {
      startLoop()
      return
    }
    player.seek(loopTimes(timeline, range).startSec)
    if (!player.isPlaying()) playPlayer()
    timeSec = player.getTime()
  }

  function ensureFrames(): void {
    if (frame === null && (phase === 'playing' || phase === 'counting')) frame = requestAnimationFrame(tick)
  }

  function tick(): void {
    frame = null
    if (phase !== 'playing' && phase !== 'counting') {
      lastTickAt = null
      return
    }
    const now = performance.now()
    frameSec = lastTickAt === null ? FIRST_FRAME_SEC : Math.min(MAX_FRAME_SEC, Math.max(MIN_FRAME_SEC, (now - lastTickAt) / 1000))
    lastTickAt = now
    step()
    publish()
    ensureFrames()
  }

  function step(): void {
    if (countMode === 'click') {
      const elapsedSec = (performance.now() - clickStartedAt) / 1000
      const beat = clickBeatStarts.filter((start) => start <= elapsedSec).length
      if (count !== null) count = { beat: Math.min(Math.max(beat, 1), count.of), of: count.of }
      if (underClicks) {
        timeSec = player.getTime()
        updateFade()
      }
      return
    }
    timeSec = player.getTime()
    if (countMode === 'pre-roll') {
      if (timeSec >= countTargetSec) {
        countMode = null
        count = null
        phase = 'playing'
      } else if (count !== null) {
        const beat = preRollBeats.filter((time) => time <= timeSec).length
        count = { beat: Math.min(Math.max(beat, 1), count.of), of: count.of }
      }
    }
    updateFade()
    // Wrap on the last frame that ends before the loop end, never after: the next bar's attack must not leak.
    if (phase === 'playing' && looping && range !== null && timeSec + frameSec * speed >= loopTimes(timeline, range).endSec) {
      wrap()
    }
    scheduleClicks()
  }

  function pauseNow(): void {
    abortCount()
    stopClicks()
    player.pause()
    timeSec = player.getTime()
    phase = 'paused'
  }

  function onPlayerEvent(event: PlayerEvent): void {
    if (event === 'seek') {
      stopClicks()
      timeSec = player.getTime()
      if (ownSeekSec !== null && Math.abs(timeSec - ownSeekSec) <= OWN_SEEK_SLACK_SEC) ownSeekSec = null
      else clearFade()
      // The pre-roll of a count-in starts before the loop on purpose; any other seek out of the range leaves the loop.
      if (looping && range !== null && phase !== 'counting' && !insideRange(timeSec)) looping = false
      // A move to another place inside the loop during a pause is where Play goes on from.
      if (phase === 'paused' && looping && range !== null && insideRange(timeSec) && Math.abs(timeSec - loopTimes(timeline, range).startSec) > OWN_SEEK_SLACK_SEC) resumeAs = 'resume'
      publish()
    } else if (event === 'rate') {
      stopClicks()
    } else if (event === 'loaded') {
      // Loading a recording resets the element's rate: put the piece's speed back.
      applyToPlayer()
      timeSec = player.getTime()
      publish()
    } else if (event === 'play') {
      if (phase === 'idle' || phase === 'paused') {
        phase = 'playing'
        publish()
        ensureFrames()
      }
    } else if ((event === 'pause' || event === 'ended') && !player.isPlaying() && countMode !== 'click') {
      if (phase !== 'playing' && phase !== 'counting') return
      const duration = player.getDuration()
      const atEnd = duration !== null && player.getTime() >= duration
      if (atEnd && phase === 'playing' && looping && range !== null) {
        wrap()
        publish()
        return
      }
      resumeAs = phase === 'counting' ? 'restart' : 'resume'
      abortCount()
      stopClicks()
      timeSec = player.getTime()
      phase = 'paused'
      publish()
    }
  }

  function insideRange(timeSec: number): boolean {
    if (range === null) return false
    const { startSec, endSec } = loopTimes(timeline, range)
    return timeSec >= startSec - RANGE_SLACK_SEC && timeSec < endSec
  }

  function applyToPlayer(): void {
    player.setVolume(muted ? 0 : musicVolume)
    try {
      player.setRate(speed)
    } catch {
      // A player that offers other rates keeps its own.
    }
  }

  function applyToSynth(): void {
    synth.setTone(metronome.tone)
    synth.setVolume(metronome.volume)
  }

  // --- the controls ---------------------------------------------------------

  /** The position of the bar the playhead is in (the last bar that starts at or before it), or null before the first. */
  function barAtPlayhead(): number | null {
    const at = player.getTime()
    let found: number | null = null
    for (let position = 0; position < timeline.length; position++) {
      if (timeline[position].startSec <= at + 1e-6) found = position
      else break
    }
    return found
  }

  /** Every control that starts sound runs inside a tap: browsers allow the click synth and the player's volume control then. */
  function unlockAudio(): void {
    void synth.resume().catch(() => {})
    player.prepare()
  }

  const controls: PracticeControls = {
    playPause() {
      unlockAudio()
      if (phase === 'playing') {
        resumeAs = 'resume'
        pauseNow()
        publish()
      } else if (phase === 'counting') {
        pauseNow()
        resumeAs = 'restart'
        publish()
      } else if (range !== null && looping && (phase === 'idle' || resumeAs === 'restart' || !insideRange(player.getTime()))) {
        // A playhead left outside the loop has nothing to resume: a loop that is on always starts from its first bar.
        startLoop()
      } else if (countInBars > 0 && !(range !== null && looping) && barAtPlayhead() !== null) {
        const position = barAtPlayhead() as number
        startAt(position, timeline[position].startSec, false)
      } else {
        phase = 'playing'
        playPlayer()
        publish()
        ensureFrames()
      }
    },

    restartLoop() {
      unlockAudio()
      if (range !== null) {
        startLoop()
        return
      }
      abortCount()
      player.seek(0)
      if (!player.isPlaying()) {
        phase = 'playing'
        playPlayer()
      }
      timeSec = player.getTime()
      publish()
      ensureFrames()
    },

    nextLoop() {
      if (range === null) return
      const next = nextLoopRange(timeline, range)
      if (next === null) return
      unlockAudio()
      range = next
      markDirty()
      startLoop()
    },

    setLooping(on) {
      if (!on) {
        looping = false
        publish()
        return
      }
      if (range === null) return
      if (phase === 'counting') {
        startLoop()
        return
      }
      looping = true
      resumeAs = 'restart'
      player.seek(loopTimes(timeline, range).startSec)
      timeSec = player.getTime()
      publish()
    },

    setLoop(next, on) {
      clearFade()
      if (phase === 'counting') pauseNow()
      range = next === null ? null : { ...next }
      looping = range !== null && on
      markDirty()
      publish()
    },

    setRange(next) {
      clearFade()
      if (phase === 'counting') pauseNow()
      range = next === null ? null : { ...next }
      looping = range !== null
      resumeAs = 'restart'
      tempoSource = 'loop-first-bar'
      markDirty()
      publish()
    },

    playFrom(position) {
      if (timeline.length === 0) return
      unlockAudio()
      abortCount()
      const inside = range !== null && position >= range.startPosition && position <= range.endPosition
      if (!inside) looping = false
      resumeAs = 'resume'
      phase = 'playing'
      player.seek(timeline[Math.min(Math.max(Math.trunc(position), 0), timeline.length - 1)].startSec)
      timeSec = player.getTime()
      if (!player.isPlaying()) playPlayer()
      publish()
      ensureFrames()
    },

    selectBar(position) {
      if (timeline.length === 0) return
      const wasPlaying = phase === 'playing'
      if (phase === 'counting') pauseNow()
      abortCount()
      const inside = range !== null && position >= range.startPosition && position <= range.endPosition
      if (!inside) looping = false
      resumeAs = 'resume'
      if (phase === 'idle') phase = 'paused'
      player.seek(timeline[Math.min(Math.max(Math.trunc(position), 0), timeline.length - 1)].startSec)
      timeSec = player.getTime()
      if (wasPlaying && !player.isPlaying()) playPlayer()
      publish()
      ensureFrames()
    },

    setSpeed(rate, options) {
      const snapped = snapSpeed(rate)
      if (snapped === null) return
      speed = snapped
      applyToPlayer()
      stopClicks()
      markDirty()
      // The click count-in is planned at the speed: count in again at the new one (after the drag, when there is one).
      if (countMode !== 'click') {
        speedRestartPending = false
        publish()
      } else if (options?.live === true) {
        speedRestartPending = true
        publish()
      } else {
        speedRestartPending = false
        startLoop()
      }
    },

    commitSpeed() {
      if (!speedRestartPending) return
      speedRestartPending = false
      if (countMode === 'click') startLoop()
    },

    setCountInBars(bars) {
      countInBars = bars
      data.setCountInBars(pieceId, bars).catch(() => {})
      publish()
    },

    setTempoSource(source) {
      tempoSource = source
      publish()
    },

    setCountInEveryRepeat(on) {
      countInEveryRepeat = on
      markDirty()
      publish()
    },

    setCountInMetronome(on) {
      countInMetronome = on
      stopClicks()
      markDirty()
      publish()
    },

    setMetronome(change) {
      const next = { ...metronome }
      if (typeof change.on === 'boolean') next.on = change.on
      if (typeof change.volume === 'number' && Number.isFinite(change.volume)) next.volume = clamp01(change.volume)
      if (change.tone !== undefined && CLICK_TONES.includes(change.tone)) next.tone = change.tone
      const switched = next.on !== metronome.on
      metronome = next
      applyToSynth()
      if (switched) stopClicks()
      markDirty()
      publish()
    },

    setMuted(on) {
      if (muted === on) return
      muted = on
      player.setVolume(muted ? 0 : musicVolume)
      publish()
    },

    setMusicVolume(volume) {
      if (!Number.isFinite(volume)) return
      musicVolume = clamp01(volume)
      muted = false
      player.setVolume(musicVolume)
      markDirty()
      publish()
    },
  }

  const unsubscribers: Array<() => void> = []

  return {
    controls,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(change) {
      data = change.data
      timeline = change.timeline
      marks = change.marks
      countInFade = change.countInFade
    },
    start() {
      if (unsubscribers.length > 0) return
      unsubscribers.push(player.onChange(onPlayerEvent))
      applyToPlayer()
      applyToSynth()
      timeSec = player.getTime()
      publish()
      ensureFrames()
    },
    stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      lastTickAt = null
      if (countMode === 'click') {
        abortCount()
        phase = 'paused'
      }
      stopClicks()
      clearFade()
      flushSave()
    },
  }
}
