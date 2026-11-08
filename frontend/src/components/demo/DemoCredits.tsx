import { useEffect, useState } from 'react'
import { usePhoneLayout } from '@/components/practice/usePhoneLayout'
import { type DemoCredit } from '@/lib/demo/demoBundle'
import { strings } from '@/strings'

const linkClass = 'underline underline-offset-2 transition-colors hover:text-foreground'

function CreditLink({ href, children }: { href: string; children: string }) {
  // A new tab, so the visitor does not lose the piece they are practising.
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  )
}

/**
 * The credits of a demo bundle, in one small line under the Practice screen. A licence such as CC BY requires them to show with
 * the music. On a phone the line would take the score's height, so the word Credits stays on the screen and a tap opens them.
 */
export function DemoCredits({ load }: { load: () => Promise<DemoCredit[]> }) {
  const phone = usePhoneLayout()
  const [credits, setCredits] = useState<DemoCredit[]>([])
  useEffect(() => {
    let live = true
    // The screen around this line has read the same bundle, so a failure here has already shown there.
    load().then(
      (read) => {
        if (live) setCredits(read)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [load])

  if (credits.length === 0) return null
  const lines = credits.map(({ what, who, title, source, licence, licenceUrl, note }, index) => (
    <span key={what}>
      {index > 0 && ' '}
      {what}:{' '}
      {title === undefined ? (
        <CreditLink href={source}>{who}</CreditLink>
      ) : (
        <>
          <CreditLink href={source}>{title}</CreditLink> by {who}
        </>
      )}
      , {licenceUrl === undefined ? licence : <CreditLink href={licenceUrl}>{licence}</CreditLink>}.{note !== undefined && ` ${note}`}
    </span>
  ))
  if (phone) {
    return (
      <details data-slot="demo-credits" className="shrink-0 text-xs leading-snug text-text-muted">
        <summary className="cursor-pointer py-0.5">{strings.demo.credits}</summary>
        <p>{lines}</p>
      </details>
    )
  }
  return (
    <p data-slot="demo-credits" className="text-xs leading-snug text-text-muted">
      {lines}
    </p>
  )
}
