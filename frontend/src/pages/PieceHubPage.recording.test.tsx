import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { createFakes, type Fakes } from '@/lib/fakes'
import { type FakePlayer } from '@/lib/fakes/fakePlayer'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const CLARK = 'piece-clark-county'
const DURATION = 271
const WIDTH = 800

/** The hub of Clark County (a 271 s recording) once its waveform has loaded; the fake player is made by the card. */
async function openHub(fakes: Fakes = createFakes({ seed: 'demo' })) {
  const made: FakePlayer[] = []
  const view = renderWithApp(`/pieces/${CLARK}`, {
    fakes,
    playerSec: DURATION,
    onMedia: (media) => {
      if (media.player !== undefined) made.push(media.player)
    },
  })
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(document.querySelectorAll('[data-slot="wave-bar"]')).toHaveLength(80))
  await screen.findByRole('slider', { name: hub.recordingPosition })
  return { ...view, fakes, made }
}

const strip = () => {
  const el = screen.getByRole('slider', { name: hub.recordingPosition })
  el.getBoundingClientRect = () => ({ left: 100, top: 0, width: WIDTH, height: 56, right: 100 + WIDTH, bottom: 56, x: 100, y: 0, toJSON() {} })
  return el
}
const at = (fraction: number) => ({ clientX: 100 + fraction * WIDTH, pointerId: 1 })
const timer = () => screen.getByRole('timer', { name: strings.dock.timeLabel })
const playButton = () => screen.getByRole('button', { name: strings.hub.playRecording })

describe('Piece hub: playing the recording', () => {
  it('shows the Play the recording ring of 88 px and the time as m:ss / m:ss on the Recording card', async () => {
    await openHub()

    expect(playButton()).toHaveClass('size-[72px]')
    expect(playButton().closest('[data-slot="play-ring"]')).toHaveClass('size-[88px]')
    expect(playButton().closest('[data-slot="play-ring"]')?.querySelectorAll('[data-tick]')).toHaveLength(48)
    expect(timer()).toHaveTextContent('0:00 / 4:31')
  })

  it('makes one player and loads nothing until the first play or seek', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const audioUrl = vi.spyOn(fakes.data, 'getAudioUrl')
    const { made } = await openHub(fakes)

    expect(made).toHaveLength(1)
    expect(made[0].loadedUrl).toBeNull()
    expect(audioUrl).not.toHaveBeenCalled()
  })

  it('plays on Play and pauses on Pause, loading the stored recording', async () => {
    const { user, made } = await openHub()

    await user.click(playButton())
    await waitFor(() => expect(made[0].isPlaying()).toBe(true))
    expect(made[0].loadedUrl).not.toBeNull()
    expect(screen.queryByRole('button', { name: strings.hub.playRecording })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: strings.hub.pauseRecording }))

    expect(made[0].isPlaying()).toBe(false)
    expect(playButton()).toBeInTheDocument()
  })

  it('moves the playhead and the time with the player while it plays', async () => {
    const { user, made } = await openHub()
    await user.click(playButton())
    await waitFor(() => expect(made[0].isPlaying()).toBe(true))

    act(() => made[0].advance(67.75))

    await waitFor(() => expect(timer()).toHaveTextContent('1:07 / 4:31'))
    const playhead = document.querySelector<HTMLElement>('[data-slot="playhead"]')!
    expect(parseFloat(playhead.style.left)).toBeCloseTo((67.75 / DURATION) * 100, 1)
    // A quarter of the recording has played: a quarter of the ring's 48 ticks is lit, 12 counting the head.
    expect(document.querySelectorAll('[data-slot="play-ring"] [data-tick="filled"], [data-slot="play-ring"] [data-tick="head"]')).toHaveLength(12)
  })

  it('seeks to the time under the pointer on a tap, and loads the recording to do it', async () => {
    const { made } = await openHub()

    fireEvent.pointerDown(strip(), at(0.5))
    fireEvent.pointerUp(strip(), at(0.5))

    await waitFor(() => expect(made[0].loadedUrl).not.toBeNull())
    await waitFor(() => expect(made[0].getTime()).toBeCloseTo(DURATION / 2, 3))
    expect(timer()).toHaveTextContent('2:15 / 4:31')
    expect(made[0].isPlaying()).toBe(false)
  })

  it('seeks to the time under the pointer while the playhead is dragged', async () => {
    const { made, user } = await openHub()
    await user.click(playButton())
    await waitFor(() => expect(made[0].isPlaying()).toBe(true))

    fireEvent.pointerDown(strip(), at(0.1))
    expect(made[0].getTime()).toBeCloseTo(0.1 * DURATION, 3)
    fireEvent.pointerMove(strip(), { ...at(0.6), buttons: 1 })
    expect(made[0].getTime()).toBeCloseTo(0.6 * DURATION, 3)
    fireEvent.pointerMove(strip(), { ...at(1.4), buttons: 1 })
    expect(made[0].getTime()).toBeCloseTo(DURATION, 3)
    fireEvent.pointerUp(strip(), at(1.4))

    expect(timer()).toHaveTextContent('4:31 / 4:31')
  })

  it('ignores a pointer that moves over the waveform with no button down', async () => {
    const { made } = await openHub()

    fireEvent.pointerMove(strip(), { ...at(0.5), buttons: 0 })

    expect(made[0].loadedUrl).toBeNull()
    expect(timer()).toHaveTextContent('0:00 / 4:31')
  })

  it('binds neither Space nor the arrow keys on the page', async () => {
    const { made } = await openHub()

    fireEvent.keyDown(document.body, { key: ' ' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    expect(made[0].isPlaying()).toBe(false)
    expect(made[0].loadedUrl).toBeNull()
  })

  it('destroys the player when the hub is left', async () => {
    const { made, unmount } = await openHub()
    const destroy = vi.spyOn(made[0], 'destroy')

    unmount()

    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('shows the card without controls when the piece has no waveform yet', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.getPeaks = async () => null
    renderWithApp(`/pieces/${CLARK}`, { fakes })

    expect(await screen.findByText(hub.waveformMissing)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.hub.playRecording })).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('takes the controls away when there turns out to be no recording to play', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.getAudioUrl = async () => null
    const { user } = await openHub(fakes)

    await user.click(playButton())

    await waitFor(() => expect(screen.queryByRole('button', { name: strings.hub.playRecording })).not.toBeInTheDocument())
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="wave-bar"]')).toHaveLength(80)
  })

  it('says so when the recording cannot be loaded', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.getAudioUrl = async () => 'fail:nope'
    const { user } = await openHub(fakes)

    await user.click(playButton())

    expect(await screen.findByText(strings.player.loadFailed)).toBeInTheDocument()
  })
})
