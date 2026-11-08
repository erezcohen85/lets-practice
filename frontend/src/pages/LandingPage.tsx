import { AudioWaveform, Play, Share2, Upload, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { GoogleSignInButton } from '@/components/landing/GoogleSignInButton'
import { LandingFilm } from '@/components/landing/LandingFilm'
import { Wordmark } from '@/components/shell/Wordmark'
import { glowClass } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'
import { useSignIn } from '@/lib/useSignIn'
import { strings } from '@/strings'

const container = 'mx-auto w-full max-w-[1200px] px-5 sm:px-8'
const navLink = 'inline-flex min-h-11 items-center text-[15px] text-text-muted transition-colors hover:text-foreground'

// The four feature cards each have an icon in a tinted square: teal, violet and pink are the waveform's colours, amber is
// the hero subtitle's. They sit in the order of strings.landing.features: Upload, Align (a sound wave: aligned to the
// recording), Practice (the play triangle the app uses for Practice), Share.
const FEATURE_LOOKS: { icon: LucideIcon; text: string; tint: string }[] = [
  { icon: Upload, text: 'text-wave-low', tint: 'bg-[color-mix(in_oklab,var(--lp-wave-low)_14%,transparent)]' },
  { icon: AudioWaveform, text: 'text-wave-mid', tint: 'bg-[color-mix(in_oklab,var(--lp-wave-mid)_14%,transparent)]' },
  { icon: Play, text: 'text-selected', tint: 'bg-[color-mix(in_oklab,var(--lp-selected)_14%,transparent)]' },
  { icon: Share2, text: 'text-wave-high', tint: 'bg-[color-mix(in_oklab,var(--lp-wave-high)_14%,transparent)]' },
]

// The teal hero button: 52 px, the play disc at its start (the same disc as the piece hub's Practice link, smaller).
const demoLinkClass = cn(
  'inline-flex h-13 items-center justify-center gap-2 rounded-lg bg-primary px-2.5 text-sm font-semibold text-on-primary',
  glowClass,
  'transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50',
)

/**
 * The way in for visitors: what the app does, the one-minute film of it, and two ways to start: sign in with Google, or
 * the practice demo. Signed-in users never see it (the route guard).
 */
export function LandingPage() {
  const { signIn, pending, failed } = useSignIn()
  // Also a sign-in that failed before this page opened: Google's return with an error, or a profile that could not be read.
  const { problem } = useSession()
  const showFailed = !pending && (failed || problem)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={cn(container, 'flex flex-wrap items-center justify-between gap-4 py-6')}>
        <Wordmark size={56} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a href={strings.landing.githubUrl} className={navLink}>
            {strings.landing.github}
          </a>
          <Link to="/terms" className={navLink}>
            {strings.landing.terms}
          </Link>
          <a href={strings.landing.contactUrl} className={navLink}>
            {strings.landing.contact}
          </a>
        </div>
      </header>

      <main className="flex-1">
        <section className={cn(container, 'flex flex-wrap items-center gap-12 pt-14 pb-6')}>
          <div className="flex basis-[420px] grow flex-col gap-6">
            <h1 className="text-5xl leading-[1.05] font-bold tracking-[-0.02em] sm:text-[56px]">
              {strings.landing.headline[0]} <br />
              {strings.landing.headline[1]}
            </h1>
            <p className="-mt-2 text-[22px] leading-[30px] font-semibold tracking-[-0.2px] text-selected">{strings.landing.subtitle}</p>
            {/* Two buttons side by side from sm; they stack below it. */}
            <div className="grid max-w-[494px] grid-cols-1 gap-2 sm:grid-cols-2">
              <GoogleSignInButton disabled={pending} onClick={signIn}>
                {strings.landing.signInOrUp}
              </GoogleSignInButton>
              <Link to="/demo" className={demoLinkClass}>
                <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full bg-on-primary">
                  <Play className="size-3.5 fill-current text-primary" strokeWidth={2} />
                </span>
                {strings.landing.practiceDemo}
              </Link>
            </div>
            {showFailed && (
              <p role="alert" className="text-[15px] text-problem">
                {strings.landing.signInFailed}
              </p>
            )}
            <p className="max-w-[480px] text-xl leading-normal text-text-soft">{strings.landing.intro}</p>
          </div>
          <div className="flex min-w-0 basis-[520px] grow flex-col">
            <LandingFilm />
          </div>
        </section>

        <section className={cn(container, 'pt-10 pb-14')}>
          <h2 className="mb-4 text-base font-semibold text-text-soft">{strings.landing.howItWorks}</h2>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {strings.landing.features.map(({ title, text }, index) => {
              const { icon: Icon, text: colour, tint } = FEATURE_LOOKS[index]
              return (
                <li key={title} className="rounded-lg border border-border bg-surface p-6">
                  <h3 className="mb-3 flex items-center gap-3 text-xl leading-7 font-bold">
                    <span aria-hidden="true" className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]', tint)}>
                      <Icon className={cn('size-[18px]', colour)} strokeWidth={2} />
                    </span>
                    {title}
                  </h3>
                  <p className="text-[15px] leading-normal text-text-soft">{text}</p>
                </li>
              )
            })}
          </ul>
        </section>
      </main>

      <footer className={cn(container, 'flex flex-wrap justify-between gap-x-4 gap-y-2 border-t border-surface-3 pt-6 pb-10 text-sm text-text-muted')}>
        <span className="inline-flex min-h-11 items-center">{strings.landing.licence}</span>
        <div className="flex gap-6">
          <a href={strings.landing.githubUrl} className={cn(navLink, 'text-sm')}>
            {strings.landing.github}
          </a>
          <Link to="/terms" className={cn(navLink, 'text-sm')}>
            {strings.landing.terms}
          </Link>
          <a href={strings.landing.contactUrl} className={cn(navLink, 'text-sm')}>
            {strings.landing.contact}
          </a>
        </div>
      </footer>
    </div>
  )
}
