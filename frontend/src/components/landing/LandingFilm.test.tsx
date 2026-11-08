import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FILM_CREDITS } from '@/components/landing/filmCredits'
import { LandingFilm } from '@/components/landing/LandingFilm'
import { strings } from '@/strings'

const film = strings.landing.film

// jsdom has no media playback: play and pause only send the events a browser would.
let play: ReturnType<typeof vi.spyOn>
let pause: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
})

// Like a browser before the visitor's first tap: it refuses to play with sound, and plays muted.
function refuseSound() {
  play.mockImplementation(function (this: HTMLMediaElement) {
    if (!this.muted) return Promise.reject(new DOMException('needs a tap first', 'NotAllowedError'))
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
}

const video = () => screen.getByLabelText(film.label) as HTMLVideoElement
const controls = () => screen.getByRole('group', { name: film.controls })

function stubReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

// An IntersectionObserver the test drives: `show(false)` scrolls the film out of view, `show(true)` back in.
function stubViewport() {
  let report: (entries: { isIntersecting: boolean }[]) => void = () => {}
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        report = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  return { show: (visible: boolean) => act(() => report([{ isIntersecting: visible }])) }
}

describe('the landing film', () => {
  it('is a looping video that plays inline, with a poster and two sizes: 1080p for wide windows, 720p for the rest', () => {
    render(<LandingFilm />)

    const v = video()
    expect(v.tagName).toBe('VIDEO')
    expect(v.loop).toBe(true)
    expect(v).toHaveAttribute('playsinline')
    expect(v).toHaveAttribute('preload', 'metadata')
    expect(v.getAttribute('poster')).toContain('lets-practice-film-poster')
    const sources = [...v.querySelectorAll('source')]
    expect(sources.map((source) => source.getAttribute('src'))).toEqual([
      expect.stringContaining('lets-practice-film-1080'),
      expect.stringContaining('lets-practice-film-720'),
    ])
    expect(sources[0]).toHaveAttribute('media', '(min-width: 720px)')
    expect(sources[1]).not.toHaveAttribute('media')
    for (const source of sources) expect(source).toHaveAttribute('type', 'video/mp4')
  })

  it('tells a screen reader what the film shows, its captions included', () => {
    render(<LandingFilm />)

    expect(video()).toHaveAccessibleDescription(film.description)
    for (const caption of ['Upload your music', 'Get interactive sheet music', 'Aligned to your recording', 'Share with your students and ensemble', 'They practice with your recording', 'Each player sees their own part']) {
      expect(film.description).toContain(caption)
    }
  })

  it('starts by itself with the sound on where the browser allows it', () => {
    render(<LandingFilm />)

    expect(play).toHaveBeenCalledTimes(1)
    expect(video().muted).toBe(false)
    expect(within(controls()).getByRole('button', { name: film.pause })).toBeInTheDocument()
    expect(within(controls()).getByRole('button', { name: film.soundOff })).toBeInTheDocument()
  })

  it('starts with the sound off where the browser refuses sound before a tap, and offers it in words', async () => {
    refuseSound()
    render(<LandingFilm />)
    await act(async () => {})

    expect(play).toHaveBeenCalledTimes(2)
    expect(video().muted).toBe(true)
    expect(within(controls()).getByRole('button', { name: film.pause })).toBeInTheDocument()
    expect(within(controls()).getByRole('button', { name: film.soundOn })).toBeInTheDocument()
  })

  it('turns the sound on at the first tap or key anywhere on the page, once the browser allows it', async () => {
    refuseSound()
    render(
      <>
        <p>Elsewhere on the page</p>
        <LandingFilm />
      </>,
    )
    await act(async () => {})
    expect(video().muted).toBe(true)

    act(() => screen.getByText('Elsewhere on the page').dispatchEvent(new Event('pointerup', { bubbles: true })))
    expect(video().muted).toBe(false)
    expect(within(controls()).getByRole('button', { name: film.soundOff })).toBeInTheDocument()
  })

  it('also turns it on at the first key', async () => {
    refuseSound()
    const user = userEvent.setup()
    render(<LandingFilm />)
    await act(async () => {})

    await user.keyboard('{Tab}')
    expect(video().muted).toBe(false)
  })

  it('leaves the sound as the visitor set it with the sound button', async () => {
    const user = userEvent.setup()
    render(
      <>
        <p>Elsewhere on the page</p>
        <LandingFilm />
      </>,
    )

    await user.click(within(controls()).getByRole('button', { name: film.soundOff }))
    await user.click(screen.getByText('Elsewhere on the page'))
    expect(video().muted).toBe(true)
  })

  it('leaves the sound off when the first tap is on the film itself, which only pauses it', async () => {
    refuseSound()
    const user = userEvent.setup()
    render(<LandingFilm />)
    await act(async () => {})

    await user.click(video())
    expect(pause).toHaveBeenCalledTimes(1)
    expect(video().muted).toBe(true)
  })

  it('does not start by itself for someone who asked for less motion', () => {
    stubReducedMotion()
    render(<LandingFilm />)

    expect(play).not.toHaveBeenCalled()
    expect(within(controls()).getByRole('button', { name: film.play })).toBeInTheDocument()
  })

  it('pauses and plays from its button, which says what it will do', async () => {
    const user = userEvent.setup()
    render(<LandingFilm />)

    await user.click(within(controls()).getByRole('button', { name: film.pause }))
    expect(pause).toHaveBeenCalledTimes(1)
    await user.click(within(controls()).getByRole('button', { name: film.play }))
    expect(play).toHaveBeenCalledTimes(2)
    expect(within(controls()).getByRole('button', { name: film.pause })).toBeInTheDocument()
  })

  it('pauses and plays when the picture itself is clicked', async () => {
    const user = userEvent.setup()
    render(<LandingFilm />)

    await user.click(video())
    expect(pause).toHaveBeenCalledTimes(1)
    await user.click(video())
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('turns the sound off and on', async () => {
    const user = userEvent.setup()
    render(<LandingFilm />)

    await user.click(within(controls()).getByRole('button', { name: film.soundOff }))
    expect(video().muted).toBe(true)
    await user.click(within(controls()).getByRole('button', { name: film.soundOn }))
    expect(video().muted).toBe(false)
  })

  it('plays from the start', async () => {
    const user = userEvent.setup()
    render(<LandingFilm />)
    video().currentTime = 30

    await user.click(within(controls()).getByRole('button', { name: film.restart }))
    expect(video().currentTime).toBe(0)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('goes full screen where the browser can', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    ;(HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen = requestFullscreen
    const user = userEvent.setup()
    render(<LandingFilm />)

    await user.click(within(controls()).getByRole('button', { name: film.fullScreen }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('has no full screen button where the browser cannot', () => {
    render(<LandingFilm />)

    expect(within(controls()).queryByRole('button', { name: film.fullScreen })).not.toBeInTheDocument()
  })

  it('rests while scrolled out of view, and goes on when back, unless the visitor paused it', async () => {
    const viewport = stubViewport()
    const user = userEvent.setup()
    render(<LandingFilm />)

    viewport.show(true)
    viewport.show(false)
    expect(pause).toHaveBeenCalledTimes(1)
    viewport.show(true)
    expect(play).toHaveBeenCalledTimes(2)

    await user.click(within(controls()).getByRole('button', { name: film.pause }))
    viewport.show(false)
    viewport.show(true)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('credits the recording with its title, a link to its source and its licence, says how it was used, and credits the score', async () => {
    render(<LandingFilm />)

    const credits = await screen.findByText((_, element) => element?.getAttribute('data-slot') === 'demo-credits')
    expect(within(credits).getByRole('link', { name: 'Mendelssohn Venetianisches Gondellied op.30 no.6' })).toHaveAttribute('href', expect.stringContaining('commons.wikimedia.org'))
    expect(within(credits).getByRole('link', { name: 'CC BY 3.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/3.0/')
    expect(credits).toHaveTextContent('by FAE Piano cafe')
    expect(credits).toHaveTextContent(film.creditNote)
    expect(within(credits).getByRole('link', { name: 'Breitkopf & Härtel edition, scan from IMSLP' })).toHaveAttribute('href', expect.stringContaining('imslp.org'))
  })

  it('takes its credits from the /demo bundle, so the two cannot drift apart; only the note on how it was used differs', () => {
    const bundle = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../public/demo/gondola-song/demo.json'), 'utf8')) as { credits: object[] }
    const [recording, score] = bundle.credits as [Record<string, string>, Record<string, string>]

    expect(FILM_CREDITS).toEqual([{ ...recording, note: film.creditNote }, score])
  })
})
