import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { BackLink } from '@/components/shell/BackLink'
import { LogoRing } from '@/components/shell/LogoRing'
import { PageColumn } from '@/components/shell/PageColumn'
import { EmptyState, ErrorState, LoadingState } from '@/components/shell/StateCards'
import { TopBar } from '@/components/shell/TopBar'
import { ClientsProvider } from '@/lib/clients'
import { createFakes, type CreateFakesOptions } from '@/lib/fakes'
import { SessionProvider } from '@/lib/session'
import { OTHER_USER, recordUsage, setPlanLimits, signInAs } from '@/lib/fakes/store'
import { TERMS_VERSION } from '@/domain/terms'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { shareLinkOn } from '@/test/shareLink'

function renderInApp(ui: ReactNode, options?: CreateFakesOptions) {
  const fakes = createFakes(options)
  return render(
    <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>
      <SessionProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </SessionProvider>
    </ClientsProvider>,
  )
}

describe('LogoRing', () => {
  it('is decorative, round and as big as asked', () => {
    const { container } = render(<LogoRing size={72} />)
    const ring = container.firstElementChild

    expect(ring).toHaveAttribute('aria-hidden', 'true')
    expect(ring).toHaveStyle({ width: '72px', height: '72px' })
    expect(ring).toHaveClass('rounded-full')
  })

  it('is 48 px by default, big enough to show its lines, and takes its colour from the text colour', () => {
    const { container } = render(<LogoRing />)

    expect(container.firstElementChild).toHaveStyle({ width: '48px', height: '48px' })
    expect(container.firstElementChild).toHaveClass('text-primary-strong')
  })
})

describe('TopBar', () => {
  it('shows the logo and the wordmark as a link to the library', async () => {
    renderInApp(<TopBar />, { signedIn: true })

    const link = await screen.findByRole('link', { name: strings.app.name })
    expect(link).toHaveAttribute('href', '/library')
    expect(link).toHaveClass('min-h-11')
    expect(screen.getByText(strings.app.name)).toHaveClass('uppercase')
    expect(link.querySelector('[aria-hidden="true"]')).toHaveStyle({ width: '48px', height: '48px' })
  })

  it('hides the wordmark below the sm breakpoint, so the ring alone is the link and the bar never overflows on a phone', async () => {
    renderInApp(<TopBar />, { signedIn: true })

    const link = await screen.findByRole('link', { name: strings.app.name })
    expect(link).toHaveAttribute('aria-label', strings.app.name)
    expect(screen.getByText(strings.app.name)).toHaveClass('hidden', 'sm:inline')
  })

  it('has a Settings button of 44 px with an accessible name', async () => {
    renderInApp(<TopBar />, { signedIn: true })

    const settings = await screen.findByRole('link', { name: strings.common.settings })
    expect(settings).toHaveAttribute('href', '/settings')
    expect(settings).toHaveClass('size-11')
  })

  it('shows the account avatar as a button with the first letter of the name', async () => {
    renderInApp(<TopBar />, { signedIn: true })

    const avatar = await screen.findByRole('button', { name: strings.common.account })
    expect(avatar).toHaveTextContent('D')
    expect(avatar).toHaveClass('size-11')
  })
})

describe('TopBar avatar photo', () => {
  const PHOTO = 'https://lh3.googleusercontent.com/a/photo=s96-c'

  /** The demo user, signed in, with (or without) the photo address Google gave them. */
  function renderWithPhoto(photoUrl?: string) {
    const fakes = createFakes({ signedIn: true })
    if (photoUrl !== undefined) fakes.store.users.get('user-demo')!.photoUrl = photoUrl
    const view = render(
      <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>
        <SessionProvider>
          <MemoryRouter>
            <TopBar />
          </MemoryRouter>
        </SessionProvider>
      </ClientsProvider>,
    )
    return view
  }
  const photo = (container: HTMLElement) => container.querySelector('img')

  it('has no photo for a fake user unless a test gives one', async () => {
    const { container } = renderWithPhoto()

    expect(await screen.findByRole('button', { name: strings.common.account })).toHaveTextContent('D')
    expect(photo(container)).toBeNull()
  })

  it("shows the user's own photo in the same circle at the same size, without a referrer and with an empty alt", async () => {
    const { container } = renderWithPhoto(PHOTO)

    const avatar = await screen.findByRole('button', { name: strings.common.account })
    const image = photo(container)!
    expect(image).toHaveAttribute('src', PHOTO)
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(image).toHaveAttribute('alt', '')
    expect(avatar).toContainElement(image)
    expect(avatar).toHaveClass('size-11', 'rounded-full')
    expect(image).toHaveClass('rounded-full', 'size-full')
  })

  it('keeps the letter under the photo, so the circle never shows empty while the picture loads', async () => {
    const { container } = renderWithPhoto(PHOTO)

    expect(await screen.findByRole('button', { name: strings.common.account })).toHaveTextContent('D')
    expect(photo(container)).not.toBeNull()
  })

  it('shows only the letter once the photo fails to load', async () => {
    const { container } = renderWithPhoto(PHOTO)
    await screen.findByRole('button', { name: strings.common.account })

    fireEvent.error(photo(container)!)

    expect(photo(container)).toBeNull()
    expect(screen.getByRole('button', { name: strings.common.account })).toHaveTextContent('D')
  })

  it('refuses a photo address that is not https', async () => {
    for (const address of ['http://lh3.googleusercontent.com/a/photo', 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
      const { container, unmount } = renderWithPhoto(address)
      await screen.findByRole('button', { name: strings.common.account })

      expect(photo(container)).toBeNull()
      unmount()
    }
  })
})

describe('TopBar account menu', () => {
  const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname
  const renderLibrary = () => renderWithApp('/library', { signedIn: true, termsAccepted: true })

  it('opens a menu under the avatar with Plan above Sign out', async () => {
    const { user } = renderLibrary()

    await user.click(await screen.findByRole('button', { name: strings.common.account }))

    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([strings.plans.menuItem, strings.common.signOut])
  })

  it('signs out from the menu and lands on the landing page', async () => {
    const { user, router, fakes } = renderLibrary()

    await user.click(await screen.findByRole('button', { name: strings.common.account }))
    await user.click(await screen.findByRole('menuitem', { name: strings.common.signOut }))

    await waitFor(() => expect(pathNow(router)).toBe('/'))
    expect(await fakes.data.getUser()).toBeNull()
  })

  it('says so in the menu when signing out fails, and stays on the page', async () => {
    const { user, router, fakes } = renderLibrary()
    fakes.data.signOut = () => Promise.reject(new Error('offline'))

    await user.click(await screen.findByRole('button', { name: strings.common.account }))
    await user.click(await screen.findByRole('menuitem', { name: strings.common.signOut }))

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.common.signOutFailed)
    expect(pathNow(router)).toBe('/library')
    expect(screen.getByRole('menuitem', { name: strings.common.signOut })).not.toHaveAttribute('aria-disabled', 'true')
  })
})

describe('BackLink', () => {
  it('goes back to the library by default, with the Library label', () => {
    renderInApp(<BackLink />)

    const link = screen.getByRole('link', { name: strings.common.backToLibrary })
    expect(link).toHaveAttribute('href', '/library')
    expect(link).toHaveClass('min-h-11')
  })

  it('can point elsewhere with its own label', () => {
    renderInApp(<BackLink to="/pieces/p1">Clark County</BackLink>)

    expect(screen.getByRole('link', { name: 'Clark County' })).toHaveAttribute('href', '/pieces/p1')
  })

  it('flips its chevron in a right-to-left page and hides it from assistive technology', () => {
    const { container } = renderInApp(<BackLink />)
    const chevron = container.querySelector('svg')

    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(chevron).toHaveClass('rtl:rotate-180')
  })
})

describe('PageColumn', () => {
  it('is the main landmark of the page and centres a wide column by default', () => {
    renderInApp(<PageColumn>content</PageColumn>)

    const main = screen.getByRole('main')
    expect(main).toHaveTextContent('content')
    expect(main.firstElementChild).toHaveClass('max-w-6xl', 'mx-auto')
  })

  it('centres a narrow column for single-column screens', () => {
    renderInApp(<PageColumn width="narrow">content</PageColumn>)

    expect(screen.getByRole('main').firstElementChild).toHaveClass('max-w-3xl')
  })

  it('takes extra classes for the column', () => {
    renderInApp(<PageColumn className="gap-6">content</PageColumn>)

    expect(screen.getByRole('main').firstElementChild).toHaveClass('gap-6')
  })
})

describe('state cards', () => {
  it('EmptyState shows a title, a text and an action', () => {
    renderInApp(<EmptyState title="No pieces yet" text="Add a recording." action={<button>New piece</button>} />)

    expect(screen.getByRole('heading', { name: 'No pieces yet' })).toBeInTheDocument()
    expect(screen.getByText('Add a recording.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New piece' })).toBeInTheDocument()
  })

  it('EmptyState works without an action', () => {
    renderInApp(<EmptyState title="Nothing here" text="Really nothing." />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('LoadingState is a status with skeleton cards and a caption', () => {
    const { container } = renderInApp(<LoadingState message="Loading your pieces" />)

    expect(screen.getByRole('status', { name: strings.common.loading })).toBeInTheDocument()
    expect(screen.getByText('Loading your pieces')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3)
  })

  it('ErrorState is an alert with a title, a text and its actions', () => {
    renderInApp(<ErrorState title="Something broke" text="Try once more." actions={<button>Try again</button>} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something broke')
    expect(alert).toHaveTextContent('Try once more.')
    expect(screen.getByRole('heading', { name: 'Something broke' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('ErrorState hides its icon from assistive technology', () => {
    const { container } = renderInApp(<ErrorState title="Something broke" text="Try once more." />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

const TRIAL_USER = { signedInAs: OTHER_USER.id, termsAccepted: true } as const
const planLabel = (text: string) => screen.findByText(text, { selector: '[data-slot="plan-label"] > span[aria-hidden="true"]' })

describe('the plan label in the top bar', () => {
  it('says TRIAL for a user without a plan, and a screen reader hears "Your plan: Trial"', async () => {
    renderWithApp('/library', TRIAL_USER)

    const label = (await planLabel(strings.plans.badge.trial)).closest('[data-slot="plan-label"]')!
    expect(label).toHaveTextContent(strings.plans.badgeScreenReader('Trial'))
    expect(label.tagName).not.toBe('BUTTON')
    expect(label.closest('a, button')).toBeNull()
  })

  it('says CREATOR and UNLIMITED for those plans', async () => {
    const creator = renderWithApp('/library', { ...TRIAL_USER, plans: { [OTHER_USER.email]: 'creator' } })
    expect(await planLabel(strings.plans.badge.creator)).toBeInTheDocument()
    creator.unmount()

    renderWithApp('/library', { ...TRIAL_USER, plans: { [OTHER_USER.email]: 'unlimited' } })
    expect(await planLabel(strings.plans.badge.unlimited)).toBeInTheDocument()
  })

  it('says ADMIN for the admin, whatever the plan row says', async () => {
    renderWithApp('/library', { signedIn: true, termsAccepted: true })

    const label = (await planLabel(strings.plans.badge.admin)).closest('[data-slot="plan-label"]')!
    expect(label).toHaveTextContent(strings.plans.badgeScreenReader(strings.plans.yourPlan.adminName))
  })

  it('sits right before the Settings gear', async () => {
    renderWithApp('/library', TRIAL_USER)

    const label = (await planLabel(strings.plans.badge.trial)).closest('[data-slot="plan-label"]')!
    expect(label.nextElementSibling).toBe(screen.getByRole('link', { name: strings.common.settings }))
  })

  it('shows nothing until the plan is read', () => {
    renderInApp(<TopBar />, { signedIn: true })

    expect(document.querySelector('[data-slot="plan-label"]')).toBeNull()
  })
})

describe('Your plan', () => {
  const rows = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('listitem')
      .map((row) => [...row.children].map((cell) => cell.textContent))
  async function openYourPlan(user: ReturnType<typeof renderWithApp>['user']) {
    await user.click(await screen.findByRole('button', { name: strings.common.account }))
    await user.click(await screen.findByRole('menuitem', { name: strings.plans.menuItem }))
    return screen.findByRole('dialog')
  }

  it("shows a Trial user's limits with their usage, the upgrade line and OK", async () => {
    const { user, fakes } = renderWithApp('/library', TRIAL_USER)
    const me = fakes.store.users.get(OTHER_USER.id)!
    recordUsage(fakes.store, me, 'piece_created', null)
    recordUsage(fakes.store, me, 'piece_created', null)

    const dialog = await openYourPlan(user)

    expect(within(dialog).getByRole('heading', { name: strings.plans.yourPlan.title('Trial') })).toBeInTheDocument()
    expect(rows(dialog)).toEqual([
      ['Pieces', '2 of 3 made'],
      ['Parts', '1 part per piece'],
      ['Shared pieces', '0 of 1'],
      ['Advanced Reading', 'Not included'],
      ['Split a multi-part PDF', 'Not included'],
      ['Read a part again', '2 per part'],
      ['Recording', 'Up to 10 minutes'],
      ['PDF', 'Up to 20 pages'],
    ])
    expect(within(dialog).getByText(strings.plans.upgrade)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: strings.plans.yourPlan.ok }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it("shows a Creator's limits, and No limit where a limit is empty", async () => {
    const { user } = renderWithApp('/library', { ...TRIAL_USER, plans: { [OTHER_USER.email]: 'creator' } })

    const dialog = await openYourPlan(user)

    expect(within(dialog).getByRole('heading', { name: strings.plans.yourPlan.title('Creator') })).toBeInTheDocument()
    const shown = Object.fromEntries(rows(dialog) as [string, string][])
    expect(shown['Pieces']).toBe('No limit')
    expect(shown['Parts']).toBe('No limit')
    expect(shown['Shared pieces']).toBe('No limit')
    expect(shown['Advanced Reading']).toBe('0 of 30 parts this month')
    expect(shown['Split a multi-part PDF']).toBe('Included')
    expect(shown['Read a part again']).toBe('10 per part')
    expect(shown['Recording']).toBe('Up to 20 minutes')
    expect(shown['PDF']).toBe('Up to 100 pages')
  })

  it('follows the numbers the admin set', async () => {
    const { user, fakes } = renderWithApp('/library', TRIAL_USER)
    setPlanLimits(fakes.store, 'trial', { pieces_created_max: 5, recording_minutes_max: 1, parts_per_piece_max: 4, advanced_reading: true, advanced_reading_parts_per_month: null })

    const dialog = await openYourPlan(user)

    const shown = Object.fromEntries(rows(dialog) as [string, string][])
    expect(shown['Pieces']).toBe('0 of 5 made')
    expect(shown['Recording']).toBe('Up to 1 minute')
    expect(shown['Parts']).toBe('4 parts per piece')
    expect(shown['Advanced Reading']).toBe('Included')
  })

  it('says No limits for the admin, with no rows', async () => {
    const { user } = renderWithApp('/library', { signedIn: true, termsAccepted: true })

    const dialog = await openYourPlan(user)

    expect(within(dialog).getByRole('heading', { name: strings.plans.yourPlan.title(strings.plans.yourPlan.adminName) })).toBeInTheDocument()
    expect(within(dialog).getByText(strings.plans.yourPlan.noLimits)).toBeInTheDocument()
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: strings.plans.yourPlan.ok })).toBeInTheDocument()
  })
})

describe('the top bar on New piece and the piece hub', () => {
  const hasTopBar = async () => {
    expect(await screen.findByRole('link', { name: strings.app.name })).toHaveAttribute('href', '/library')
    expect(screen.getByRole('link', { name: strings.common.settings })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.common.account })).toBeInTheDocument()
    expect(await planLabel(strings.plans.badge.admin)).toBeInTheDocument()
  }
  const aboveBackLink = () => {
    const bar = screen.getByRole('link', { name: strings.common.settings }).closest('header')!
    const back = screen.getByRole('link', { name: strings.common.backToLibrary })
    expect(bar.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }

  it('is above the back link on New piece', async () => {
    renderWithApp('/pieces/new', { signedIn: true, termsAccepted: true })

    await hasTopBar()
    aboveBackLink()
  })

  it('is above the back link on New piece for someone who may not upload', async () => {
    renderWithApp('/pieces/new', { signedIn: true, termsAccepted: true, features: { upload: false } })

    await hasTopBar()
    aboveBackLink()
  })

  it("is above the back link on an owner's hub", async () => {
    const fakes = createFakes({ seed: 'demo' })
    const ready = (await fakes.data.listPieces()).find((piece) => piece.job?.status === 'done' && piece.partCount > 0)!
    renderWithApp(`/pieces/${ready.id}`, { fakes })

    await screen.findByRole('heading', { name: ready.title })
    await hasTopBar()
    aboveBackLink()
  })

  it("is above the back link on a member's hub", async () => {
    const fakes = createFakes({ seed: 'demo' })
    const ready = (await fakes.data.listPieces()).find((piece) => piece.job?.status === 'done' && piece.partCount > 0)!
    const { token } = await shareLinkOn(fakes.data, ready.id)
    signInAs(fakes.store, OTHER_USER.id)
    const profile = fakes.store.profiles.get(OTHER_USER.id)!
    profile.acceptedTermsAt = '2026-11-03T00:00:00Z'
    profile.acceptedTermsVersion = TERMS_VERSION
    await fakes.data.joinPiece(token)
    renderWithApp(`/pieces/${ready.id}`, { fakes })

    await screen.findByRole('heading', { name: ready.title })
    expect(await screen.findByRole('link', { name: strings.app.name })).toBeInTheDocument()
    expect(await planLabel(strings.plans.badge.trial)).toBeInTheDocument()
    aboveBackLink()
  })
})
