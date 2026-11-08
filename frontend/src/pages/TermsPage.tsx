import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { GoogleSignInButton } from '@/components/landing/GoogleSignInButton'
import { Wordmark } from '@/components/shell/Wordmark'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { needsTerms } from '@/domain/terms'
import { safeNext } from '@/domain/nextPath'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'
import { useSignIn } from '@/lib/useSignIn'
import { strings } from '@/strings'

const TERMS_ID = 'terms-text'
const SUMMARY_ID = 'terms-summary'
const bigButton = 'h-13 text-[17px]'
// Sign out on the gate and Back for a visitor: the same quiet outline button beside a filled one.
const outlineButton = 'h-13 bg-transparent px-6 font-medium dark:bg-transparent dark:hover:bg-muted'
// 22 px with a bolder tick, as on the board.
const checkboxClass = 'size-[22px] [&_[data-slot=checkbox-indicator]_svg]:size-[18px] [&_[data-slot=checkbox-indicator]_svg]:stroke-3'

type Failure = 'accept' | 'sign-out' | null

/**
 * The terms. Public, in three states: a visitor can read them and sign in; a signed-in user who has not accepted them
 * is held here by the route guard until they tick the box and accept; one who has accepted can read them again.
 */
export function TermsPage() {
  const { status, user, profile, acceptTerms, signOut } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { signIn, pending: signingIn, failed: signInFailed } = useSignIn()
  const [agreed, setAgreed] = useState(false)
  // Set (to the signed-in email) while accepting or signing out, until the page is left.
  const [leavingAs, setLeavingAs] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure>(null)

  // Accepting or signing out changes the session before the page moves on: the gate stays as it is until it does,
  // instead of flashing the visitor or accepted view for a frame.
  const busy = leavingAs !== null
  const mode = busy ? 'gate' : status !== 'signed-in' ? 'visitor' : needsTerms(profile) ? 'gate' : 'accepted'

  // Each action works once: the buttons stay disabled while it runs, and on success the page is left.
  async function run(action: () => Promise<void>, onFailure: Exclude<Failure, null>) {
    setLeavingAs(user?.email ?? '')
    setFailure(null)
    try {
      await action()
    } catch {
      setFailure(onFailure)
      setLeavingAs(null)
    }
  }
  const accept = () =>
    run(async () => {
      await acceptTerms()
      void navigate(next ?? '/library')
    }, 'accept')
  // Signing out does not move the page by itself, and the landing page is where a visitor belongs.
  const leave = () =>
    run(async () => {
      await signOut()
      void navigate('/')
    }, 'sign-out')

  // Back to the page the visitor came from in this app; the landing page when /terms was opened directly (no history here).
  const goBack = () => void (location.key === 'default' ? navigate('/') : navigate(-1))

  const [beforeAccount, afterAccount] = strings.terms.gateIntro.split('{account}')
  const errorText = signInFailed
    ? strings.terms.signInFailed
    : failure === 'accept'
      ? strings.terms.acceptFailed
      : failure === 'sign-out'
        ? strings.terms.signOutFailed
        : null

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="flex w-full max-w-[560px] flex-col gap-6 rounded-card border border-border bg-surface p-6 sm:p-10">
        <Wordmark to={mode === 'visitor' ? '/' : mode === 'accepted' ? '/library' : undefined} />

        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] leading-[1.15] font-bold">{mode === 'gate' ? strings.terms.gateTitle : strings.terms.title}</h1>
          <p className="text-base leading-normal text-text-soft">
            {mode === 'gate' ? (
              <>
                {beforeAccount}
                <span className="font-medium text-foreground">{user?.email ?? leavingAs}</span>
                {afterAccount}
              </>
            ) : mode === 'visitor' ? (
              strings.terms.visitorIntro
            ) : (
              strings.terms.acceptedIntro
            )}
          </p>
        </div>

        <div
          id={TERMS_ID}
          role="region"
          aria-label={strings.terms.boxLabel}
          tabIndex={0}
          className="h-[50dvh] min-h-64 space-y-3 overflow-y-auto rounded-lg border border-border bg-background p-4 text-sm leading-[1.6] text-text-soft outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p className="font-semibold text-foreground">{strings.terms.documentTitle}</p>
          <p>{strings.terms.versionLine}</p>
          <section aria-labelledby={SUMMARY_ID} className="rounded-md border border-border bg-surface p-3">
            <h2 id={SUMMARY_ID} className="font-semibold text-foreground">
              {strings.terms.summaryTitle}
            </h2>
            <ul className="mt-1 list-disc space-y-1 ps-5">
              {strings.terms.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 text-text-muted">{strings.terms.summaryNote}</p>
          </section>
          {strings.terms.sections.map((section) => (
            <div key={section.heading}>
              <h2 className="font-semibold text-foreground">{section.heading}</h2>
              {section.blocks.map((block, index) =>
                typeof block === 'string' ? (
                  <p key={index} className={index > 0 ? 'mt-2' : undefined}>
                    {block}
                  </p>
                ) : (
                  <ul key={index} className={cn('list-disc space-y-1 ps-5', index > 0 && 'mt-2')}>
                    {block.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          ))}
        </div>

        {mode === 'gate' && (
          <>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] leading-[1.4]">
              <Checkbox checked={agreed} onCheckedChange={setAgreed} className={checkboxClass} />
              <span>
                {strings.terms.acceptBefore}
                <a href={`#${TERMS_ID}`} className="text-primary underline">
                  {strings.terms.acceptLink}
                </a>
                {strings.terms.acceptAfter}
              </span>
            </label>
            <div className="flex flex-wrap gap-3">
              <Button size="xl" className={cn(bigButton, 'flex-[1_1_200px]')} disabled={!agreed || busy} onClick={accept}>
                <ActionIcon action="confirm" />
                {strings.terms.accept}
              </Button>
              <Button variant="outline" size="xl" className={outlineButton} disabled={busy} onClick={leave}>
                {strings.terms.signOut}
              </Button>
            </div>
          </>
        )}

        {mode === 'visitor' && (
          <div className="flex flex-wrap gap-3">
            <GoogleSignInButton className="flex-[1_1_240px]" disabled={signingIn} onClick={signIn}>
              {strings.terms.signInOrUp}
            </GoogleSignInButton>
            <Button variant="outline" size="xl" className={cn(outlineButton, 'flex-[1_1_120px]')} onClick={goBack}>
              <ChevronLeft className="rtl:rotate-180" data-icon="inline-start" aria-hidden="true" />
              {strings.terms.back}
            </Button>
          </div>
        )}

        {mode === 'accepted' && (
          <Link to="/library" className={cn(buttonVariants({ size: 'xl' }), bigButton)}>
            <ActionIcon action="library" />
            {strings.common.goToLibrary}
          </Link>
        )}

        {errorText !== null && (
          <p role="alert" className="text-[15px] text-problem">
            {errorText}
          </p>
        )}
      </div>
    </main>
  )
}
