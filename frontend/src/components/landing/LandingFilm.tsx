import { Maximize, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import film1080 from '@/assets/landing/lets-practice-film-1080.mp4'
import film720 from '@/assets/landing/lets-practice-film-720.mp4'
import poster from '@/assets/landing/lets-practice-film-poster.webp'
import { DemoCredits } from '@/components/demo/DemoCredits'
import { FILM_CREDITS } from '@/components/landing/filmCredits'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const film = strings.landing.film
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const loadCredits = () => Promise.resolve(FILM_CREDITS)

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches

// Safari on an iPhone has no requestFullscreen for elements, only its own full-screen player for a video.
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }
const canFullScreen = () => typeof HTMLElement.prototype.requestFullscreen === 'function' || 'webkitEnterFullscreen' in HTMLVideoElement.prototype

const controlClass =
  'inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full text-foreground transition-colors outline-none hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring/50'

function Control({ label, onClick, children, className }: { label?: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn(controlClass, className)}>
      {children}
    </button>
  )
}

/**
 * The one-minute film of the app, in the landing page's hero. It loops with the sound on where the browser allows it.
 * Most browsers refuse sound until the visitor has tapped, clicked or typed on the page, so there it starts muted and the
 * sound comes on at that first tap or key, unless the tap was on the film, or the visitor has set the sound themselves.
 * The visitor can pause it, set the sound, start it over or watch it full screen. It does not start by itself for someone
 * who asked for less motion, and it rests while scrolled out of view. 1080p on wide windows, 720p on the rest. Its music
 * is CC BY 3.0, so the credits sit under it.
 */
export function LandingFilm() {
  const figureRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const descriptionId = useId()
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [fullScreen] = useState(canFullScreen)
  const playingRef = useRef(false)
  // Whether the film should be playing when it is in view: yes by itself, unless less motion was asked for; then the visitor's say.
  const wanted = useRef(!prefersReducedMotion())
  // Set once the visitor uses the sound button: from then on the sound is theirs, and the first tap leaves it alone.
  const soundChosen = useRef(false)

  const setSound = useCallback((on: boolean) => {
    const video = videoRef.current
    if (video === null) return
    video.muted = !on
    setMuted(!on)
  }, [])

  const start = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    video.play()?.catch((error: unknown) => {
      // A browser that refuses sound before the visitor's first tap still lets the film play muted. Any other refusal
      // leaves it paused, and the button offers Play.
      if (video.muted || !(error instanceof DOMException) || error.name !== 'NotAllowedError') return
      setSound(false)
      video.play()?.catch(() => {})
    })
  }, [setSound])

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return
    if (wanted.current) start()

    // The first tap or key anywhere else on the page lets the browser play sound, so the sound comes on then. A tap on the
    // film is left to the film's own buttons and picture. Where the browser says the gesture does not count, wait for the next.
    const gestures = ['pointerup', 'keydown'] as const
    const stopListening = () => gestures.forEach((type) => document.removeEventListener(type, onGesture, true))
    function onGesture(event: Event) {
      if (soundChosen.current || video === null || !video.muted) return stopListening()
      if (event.target instanceof Node && figureRef.current?.contains(event.target)) return
      const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
      if (activation !== undefined && !activation.isActive) return
      stopListening()
      setSound(true)
    }
    gestures.forEach((type) => document.addEventListener(type, onGesture, true))

    if (typeof IntersectionObserver !== 'function') return stopListening
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (wanted.current && !playingRef.current) start()
        } else if (playingRef.current) {
          video.pause()
        }
      },
      { threshold: 0.25 },
    )
    observer.observe(video)
    return () => {
      stopListening()
      observer.disconnect()
    }
  }, [start, setSound])

  const togglePlay = () => {
    const video = videoRef.current
    if (video === null) return
    if (playingRef.current) {
      wanted.current = false
      video.pause()
    } else {
      wanted.current = true
      start()
    }
  }

  const restart = () => {
    const video = videoRef.current
    if (video === null) return
    video.currentTime = 0
    wanted.current = true
    start()
  }

  const toggleSound = () => {
    const video = videoRef.current
    if (video === null) return
    soundChosen.current = true
    setSound(video.muted)
  }

  const goFullScreen = () => {
    const frame = frameRef.current
    const video = videoRef.current as IosVideo | null
    if (document.fullscreenElement) {
      void document.exitFullscreen?.()
    } else if (frame !== null && typeof frame.requestFullscreen === 'function') {
      void frame.requestFullscreen().catch(() => {})
    } else {
      video?.webkitEnterFullscreen?.()
    }
  }

  const onPlay = () => {
    playingRef.current = true
    setPlaying(true)
  }
  const onPause = () => {
    playingRef.current = false
    setPlaying(false)
  }
  const onTime = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const { currentTime, duration } = event.currentTarget
    setProgress(duration > 0 ? currentTime / duration : 0)
  }

  return (
    <figure ref={figureRef} data-slot="landing-film" className="flex min-w-0 flex-col gap-2">
      {/* The full-screen target holds the picture and its control bar, so the controls stay in full screen. */}
      <div ref={frameRef} className="flex flex-col overflow-hidden rounded-lg border border-border bg-background [&:fullscreen]:rounded-none [&:fullscreen]:border-0">
        {/* A click on the picture pauses or plays it; the buttons below do the same from the keyboard. */}
        <video
          ref={videoRef}
          aria-label={film.label}
          aria-describedby={descriptionId}
          className="block aspect-video w-full min-h-0 flex-1 object-contain"
          poster={poster}
          preload="metadata"
          loop
          playsInline
          onClick={togglePlay}
          onPlay={onPlay}
          onPause={onPause}
          onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
          onTimeUpdate={onTime}
        >
          <source src={film1080} type="video/mp4" media="(min-width: 720px)" />
          <source src={film720} type="video/mp4" />
        </video>
        <p id={descriptionId} className="sr-only">
          {film.description}
        </p>
        {/* Under the picture, not over it: the film's own captions run almost its full width. */}
        <div className="shrink-0 border-t border-border bg-surface">
          <div aria-hidden="true" className="h-1 bg-foreground/10">
            <div className="h-full bg-primary" style={{ width: `${(progress * 100).toFixed(2)}%` }} />
          </div>
          <div role="group" aria-label={film.controls} className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="flex items-center gap-1">
              <Control label={playing ? film.pause : film.play} onClick={togglePlay}>
                {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
              </Control>
              <Control label={film.restart} onClick={restart}>
                <RotateCcw aria-hidden="true" className="size-5" />
              </Control>
              {muted ? (
                // While the sound is off the button says so in words: the film is better with it.
                <Control onClick={toggleSound} className="ps-3 pe-4 text-sm font-semibold">
                  <VolumeX aria-hidden="true" className="size-5" />
                  {film.soundOn}
                </Control>
              ) : (
                <Control label={film.soundOff} onClick={toggleSound}>
                  <Volume2 aria-hidden="true" className="size-5" />
                </Control>
              )}
            </div>
            {fullScreen && (
              <Control label={film.fullScreen} onClick={goFullScreen}>
                <Maximize aria-hidden="true" className="size-5" />
              </Control>
            )}
          </div>
        </div>
      </div>
      <figcaption>
        <DemoCredits load={loadCredits} />
      </figcaption>
    </figure>
  )
}
