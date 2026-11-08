import { createClickSynth } from '@/lib/audio/clickSynth'

type Ramp = { kind: 'set' | 'linear' | 'exp'; value: number; time: number }

class StubParam {
  value = 0
  ramps: Ramp[] = []
  setValueAtTime(value: number, time: number) { this.ramps.push({ kind: 'set', value, time }) }
  linearRampToValueAtTime(value: number, time: number) { this.ramps.push({ kind: 'linear', value, time }) }
  exponentialRampToValueAtTime(value: number, time: number) { this.ramps.push({ kind: 'exp', value, time }) }
}

class StubNode {
  connections: unknown[] = []
  disconnects = 0
  connect(target: unknown) { this.connections.push(target); return target }
  disconnect() { this.disconnects += 1 }
}

class StubOscillator extends StubNode {
  type = ''
  frequency = new StubParam()
  startedAt: number | null = null
  stoppedAt: number | null = null
  stops = 0
  private ended = new Set<() => void>()
  start(when: number) { this.startedAt = when }
  stop(when = 0) { this.stoppedAt = when; this.stops += 1 }
  addEventListener(type: string, fn: () => void) { if (type === 'ended') this.ended.add(fn) }
  fireEnded() { this.ended.forEach((fn) => fn()) }
}

class StubGain extends StubNode {
  gain = new StubParam()
}

/** The parts of an AudioContext the synth uses, recording what it builds. */
class StubContext {
  currentTime = 0
  destination = { name: 'destination' }
  oscillators: StubOscillator[] = []
  gains: StubGain[] = []
  resume = vi.fn(async () => {})
  close = vi.fn(async () => {})
  createOscillator() { const o = new StubOscillator(); this.oscillators.push(o); return o }
  createGain() { const g = new StubGain(); this.gains.push(g); return g }
}

function setup() {
  const context = new StubContext()
  const synth = createClickSynth(context as unknown as AudioContext)
  return { context, synth }
}

const peakOf = (gain: StubGain) => gain.gain.ramps.find((r) => r.kind === 'linear')!.value

describe('createClickSynth', () => {
  it('schedules one oscillator and one gain per click, wired to the destination', () => {
    const { context, synth } = setup()
    synth.schedule(0.5, false)
    expect(context.oscillators).toHaveLength(1)
    expect(context.gains).toHaveLength(1)
    expect(context.oscillators[0].connections).toEqual([context.gains[0]])
    expect(context.gains[0].connections).toEqual([context.destination])
  })

  it('starts at currentTime plus the delay and stops at the end of the tone', () => {
    const { context, synth } = setup()
    context.currentTime = 2
    synth.setTone('wood')
    synth.schedule(0.5, false)
    const osc = context.oscillators[0]
    expect(osc.startedAt).toBe(2.5)
    const decayEnd = context.gains[0].gain.ramps[2].time
    expect(decayEnd).toBeCloseTo(2.5 + 0.001 + 0.025, 5)
    expect(osc.stoppedAt).toBeGreaterThanOrEqual(decayEnd)
    expect(osc.stoppedAt).toBeLessThan(decayEnd + 0.1)
  })

  it('shapes the gain: silent, a fast attack to the peak, then a decay to near zero', () => {
    const { context, synth } = setup()
    context.currentTime = 1
    synth.schedule(0, false)
    const [first, attack, decay] = context.gains[0].gain.ramps
    expect(first).toMatchObject({ kind: 'set', time: 1 })
    expect(first.value).toBeLessThan(0.001)
    expect(attack.kind).toBe('linear')
    expect(attack.time).toBeCloseTo(1.001, 5)
    expect(decay.kind).toBe('exp')
    expect(decay.value).toBeGreaterThan(0)
    expect(decay.value).toBeLessThan(0.001)
    expect(decay.time).toBeGreaterThan(attack.time)
  })

  it('doubles the frequency on an accent', () => {
    const { context, synth } = setup()
    synth.schedule(0, false)
    synth.schedule(0, true)
    const [plain, accent] = context.oscillators
    expect(plain.frequency.value).toBeGreaterThan(0)
    expect(accent.frequency.value).toBe(plain.frequency.value * 2)
  })

  it('sets the gain peak from the volume, louder on an accent', () => {
    const { context, synth } = setup()
    synth.setVolume(0.5)
    synth.schedule(0, false)
    synth.schedule(0, true)
    const [plain, accent] = context.gains
    expect(peakOf(accent)).toBeCloseTo(0.5, 5)
    expect(peakOf(plain)).toBeGreaterThan(0)
    expect(peakOf(plain)).toBeLessThan(peakOf(accent))
  })

  it('clamps the volume to 0..1', () => {
    const { context, synth } = setup()
    synth.setVolume(3)
    synth.schedule(0, true)
    expect(peakOf(context.gains[0])).toBe(1)
    synth.setVolume(-1)
    synth.schedule(0, true)
    expect(context.gains).toHaveLength(1)
  })

  it('schedules nothing at volume 0', () => {
    const { context, synth } = setup()
    synth.setVolume(0)
    synth.schedule(0, true)
    expect(context.oscillators).toHaveLength(0)
    expect(context.gains).toHaveLength(0)
  })

  it('has three different tones, and a tone change affects later clicks only', () => {
    const { context, synth } = setup()
    synth.setTone('wood')
    synth.schedule(0, false)
    synth.setTone('click')
    synth.schedule(0, false)
    synth.setTone('beep')
    synth.schedule(0, false)
    const [wood, click, beep] = context.oscillators
    expect(wood.frequency.value).toBe(900)
    expect(click.frequency.value).toBe(2000)
    expect(beep.frequency.value).toBe(1000)
    expect(beep.type).toBe('sine')
    expect(wood.stoppedAt! - wood.startedAt!).toBeGreaterThan(click.stoppedAt! - click.startedAt!)
    expect(beep.stoppedAt! - beep.startedAt!).toBeGreaterThan(wood.stoppedAt! - wood.startedAt!)
  })

  it('cancelAll stops and disconnects every pending source', () => {
    const { context, synth } = setup()
    synth.schedule(0.1, false)
    synth.schedule(0.2, true)
    synth.cancelAll()
    for (const osc of context.oscillators) {
      expect(osc.stops).toBe(2)
      expect(osc.stoppedAt).toBeLessThanOrEqual(context.currentTime)
      expect(osc.disconnects).toBe(1)
    }
    for (const gain of context.gains) expect(gain.disconnects).toBe(1)
  })

  it('forgets a source when it ends, so cancelAll leaves it alone', () => {
    const { context, synth } = setup()
    synth.schedule(0, false)
    synth.schedule(0.5, false)
    const [done, pending] = context.oscillators
    done.fireEnded()
    expect(done.disconnects).toBe(1)
    synth.cancelAll()
    expect(done.stops).toBe(1)
    expect(pending.stops).toBe(2)
  })

  it('resume calls context.resume()', async () => {
    const { context, synth } = setup()
    await synth.resume()
    expect(context.resume).toHaveBeenCalledTimes(1)
  })

  it('schedules nothing after destroy, and does not close a context it was given', () => {
    const { context, synth } = setup()
    synth.schedule(0.1, false)
    synth.destroy()
    expect(context.oscillators[0].stops).toBe(2)
    synth.schedule(0, false)
    expect(context.oscillators).toHaveLength(1)
    expect(context.close).not.toHaveBeenCalled()
  })

  describe('without a context', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('makes none until the first schedule or resume, then reuses it and closes it on destroy', async () => {
      const made: StubContext[] = []
      class Ctor extends StubContext { constructor() { super(); made.push(this) } }
      vi.stubGlobal('AudioContext', Ctor)
      const synth = createClickSynth()
      expect(made).toHaveLength(0)
      synth.schedule(0, false)
      await synth.resume()
      expect(made).toHaveLength(1)
      expect(made[0].oscillators).toHaveLength(1)
      expect(made[0].resume).toHaveBeenCalledTimes(1)
      synth.destroy()
      expect(made[0].close).toHaveBeenCalledTimes(1)
    })

    it('never makes one for cancelAll or destroy alone', () => {
      const made: StubContext[] = []
      class Ctor extends StubContext { constructor() { super(); made.push(this) } }
      vi.stubGlobal('AudioContext', Ctor)
      const synth = createClickSynth()
      synth.cancelAll()
      synth.destroy()
      expect(made).toHaveLength(0)
    })
  })
})
