import { Menu } from '@base-ui/react/menu'
import { Gem, LogOut, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { PlanLabel } from '@/components/plan/PlanLabel'
import { YourPlanDialog } from '@/components/plan/YourPlanDialog'
import { LogoRing } from '@/components/shell/LogoRing'
import { MENU_ITEM_CLASS, MENU_POPUP_CLASS } from '@/components/ui/more-menu'
import { safePhotoUrl } from '@/domain/photoUrl'
import { usePlan } from '@/lib/plan'
import { useSession } from '@/lib/session'
import { strings } from '@/strings'

/** The top row of the signed-in screens: logo and wordmark (to the library) at the start, Settings and the account at the end. */
export function TopBar() {
  const { user, signOut } = useSession()
  const { state: plan } = usePlan()
  const [planOpen, setPlanOpen] = useState(false)
  const initial = (user?.name.trim() || user?.email || '').charAt(0).toUpperCase()
  const photo = safePhotoUrl(user?.photoUrl)
  // The address that failed to load, so a different photo later (another sign-in) is tried again.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)

  // Signing out ends the session, and the route guard then sends the visitor to the landing page. The menu stays open
  // until then, so a failure is said where the user is looking.
  async function leave() {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      await signOut()
    } catch {
      setSignOutFailed(true)
      setSigningOut(false)
    }
  }

  return (
    <header className="flex items-center justify-between gap-2 sm:gap-4">
      <Link to="/library" aria-label={strings.app.name} className="inline-flex min-h-11 min-w-0 items-center gap-3">
        <LogoRing />
        <span className="hidden text-sm font-semibold tracking-[0.22em] uppercase sm:inline">{strings.app.name}</span>
      </Link>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <PlanLabel />
        <Link
          to="/settings"
          aria-label={strings.common.settings}
          className="inline-flex size-11 items-center justify-center rounded-lg border border-border text-text-soft transition-colors hover:bg-surface-2"
        >
          <Settings className="size-[22px]" strokeWidth={1.8} aria-hidden="true" />
        </Link>
        {/* Not modal, like the three-dot menus: the page keeps its scroll bar, and a click outside still closes it. */}
        <Menu.Root modal={false} onOpenChange={(open) => open && setSignOutFailed(false)}>
          {/* The name is on the button, so the photo inside has an empty alt. The letter stays underneath: it shows while the photo loads and when it fails, and the circle never changes size. */}
          <Menu.Trigger
            aria-label={strings.common.account}
            className="relative flex size-11 items-center justify-center rounded-full border border-border bg-surface-2 font-semibold text-primary-strong outline-none transition-colors hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:border-border-strong"
          >
            {initial}
            {photo !== undefined && photo !== failedPhoto && (
              <img
                src={photo}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setFailedPhoto(photo)}
                className="absolute inset-0 size-full rounded-full object-cover"
              />
            )}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
              <Menu.Popup className={MENU_POPUP_CLASS}>
                {plan !== null && (
                  <Menu.Item onClick={() => setPlanOpen(true)} className={`${MENU_ITEM_CLASS} text-text`}>
                    <Gem className="size-[18px] shrink-0" aria-hidden="true" />
                    {strings.plans.menuItem}
                  </Menu.Item>
                )}
                <Menu.Item closeOnClick={false} disabled={signingOut} onClick={leave} className={`${MENU_ITEM_CLASS} text-text`}>
                  <LogOut className="size-[18px] shrink-0" aria-hidden="true" />
                  {strings.common.signOut}
                </Menu.Item>
                {signOutFailed && (
                  <p role="alert" className="px-3.5 py-2 text-[13px] leading-snug text-problem">
                    {strings.common.signOutFailed}
                  </p>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {plan !== null && <YourPlanDialog state={plan} open={planOpen} onOpenChange={setPlanOpen} />}
      </div>
    </header>
  )
}
