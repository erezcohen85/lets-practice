import { cn } from '@/lib/utils'

/** A ring of radial ticks: a conic gradient under a ring-shaped mask, drawn in the text colour (primary by default). Below about 44 px the ticks blur into dots, so keep it at 48 or more. */
export function LogoRing({ size = 48, className }: { size?: number; className?: string }) {
  const ring = 'radial-gradient(circle, transparent 52%, currentColor 54%)'
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 rounded-full text-primary-strong', className)}
      style={{
        width: size,
        height: size,
        background: 'repeating-conic-gradient(currentColor 0 3deg, transparent 3deg 12deg)',
        WebkitMask: ring,
        mask: ring,
      }}
    />
  )
}
