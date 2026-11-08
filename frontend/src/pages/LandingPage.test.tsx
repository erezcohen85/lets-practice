import { screen, waitFor, within } from '@testing-library/react'
import { strings, TERMS_CONTACT } from '@/strings'
import { createFakes } from '@/lib/fakes'
import { renderWithApp } from '@/test/render'

const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname

describe('the landing page', () => {
  it('has the headline as its one level-1 heading', async () => {
    renderWithApp('/')

    const headings = await screen.findAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(strings.landing.headline.join(' '))
  })

  it('says "Practice Makes Perfect" on two lines, with the subtitle under it', async () => {
    renderWithApp('/')

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(strings.landing.headline).toEqual(['Practice', 'Makes Perfect'])
    expect(heading.querySelector('br')).not.toBeNull()
    expect(screen.getByText(strings.landing.subtitle)).toBeInTheDocument()
    expect(heading.compareDocumentPosition(screen.getByText(strings.landing.subtitle)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says what the app does, below the two buttons', async () => {
    renderWithApp('/')

    const intro = await screen.findByText(strings.landing.intro)
    const signIn = screen.getByRole('button', { name: strings.landing.signInOrUp })
    const demo = screen.getByRole('link', { name: strings.landing.practiceDemo })
    expect(signIn.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(demo.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Free and open source')).not.toBeInTheDocument()
  })

  it('has a header, a main part and a footer', async () => {
    renderWithApp('/')

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('links to GitHub, the terms and an email to contact us, from the top and from the footer', async () => {
    renderWithApp('/')
    const header = await screen.findByRole('banner')
    const footer = screen.getByRole('contentinfo')

    for (const area of [header, footer]) {
      expect(within(area).getByRole('link', { name: strings.landing.github })).toHaveAttribute('href', strings.landing.githubUrl)
      expect(within(area).getByRole('link', { name: strings.landing.terms })).toHaveAttribute('href', '/terms')
      expect(within(area).getByRole('link', { name: strings.landing.contact })).toHaveAttribute('href', `mailto:${TERMS_CONTACT}`)
    }
    expect(strings.landing.githubUrl).toBe('https://github.com/erezcohen85/lets-practice')
  })

  it('names the licence in the footer', async () => {
    renderWithApp('/')

    expect(within(await screen.findByRole('contentinfo')).getByText(strings.landing.licence)).toBeInTheDocument()
  })

  it('shows the four features: Upload, Align, Practice, Share', async () => {
    renderWithApp('/')
    await screen.findByRole('main')

    for (const { title, text } of strings.landing.features) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(strings.landing.features.map((feature) => feature.title)).toEqual(['Upload', 'Align', 'Practice', 'Share'])
    expect(strings.landing.features[1].text).toBe('The PDF aligns to the music automatically for you to review in the editor.')
    expect(strings.landing.features[2].text).toBe('Navigate the recording through interactive sheet music. Loop, slow down, find inspiration or just play along.')
    expect(strings.landing.features[3].text).toBe('Share your pieces with your students or ensemble members.')
    // An icon in a tinted square before each title, hidden from assistive technology.
    for (const heading of screen.getAllByRole('heading', { level: 3 })) expect(heading.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    // Align's icon is a sound wave, for the recording the score is aligned to.
    expect(screen.getByRole('heading', { level: 3, name: 'Align' }).querySelector('svg')).toHaveClass('lucide-audio-waveform')
    // Practice has the play triangle the app uses for Practice, in amber: teal, violet, amber, pink from the first card.
    const practice = screen.getByRole('heading', { level: 3, name: 'Practice' }).querySelector('svg')!
    expect(practice).toHaveClass('lucide-play', 'text-selected')
  })

  it('lays the four cards out in one row on wide windows, two by two in between, one above another on a phone', async () => {
    renderWithApp('/')

    const cards = await screen.findByRole('list')
    expect(cards).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-4')
  })

  it('has a small "How does it work?" title above the feature cards', async () => {
    renderWithApp('/')

    const title = await screen.findByRole('heading', { level: 2, name: 'How does it work?' })
    const cards = screen.getByRole('list')
    expect(title.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(cards).getAllByRole('listitem')).toHaveLength(strings.landing.features.length)
  })

  it('shows the film in the hero, beside the headline and after it, with its controls', async () => {
    renderWithApp('/')

    const headline = await screen.findByRole('heading', { level: 1 })
    const film = screen.getByLabelText(strings.landing.film.label)
    expect(film.closest('section')).toBe(headline.closest('section'))
    expect(headline.compareDocumentPosition(film) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(screen.getByRole('group', { name: strings.landing.film.controls })).getByRole('button', { name: strings.landing.film.restart })).toBeInTheDocument()
  })

  it('has the film in place of the drawn demo, and once: "How does it work?" holds only the feature cards', async () => {
    renderWithApp('/')

    const title = await screen.findByRole('heading', { level: 2, name: strings.landing.howItWorks })
    expect(document.querySelectorAll('[data-slot="landing-film"]')).toHaveLength(1)
    expect(title.closest('section')!.querySelector('[data-slot="landing-film"]')).toBeNull()
    expect(document.querySelector('[data-slot="demo-loop"]')).toBeNull()
    expect(document.querySelector('[data-slot="wave-bar"]')).toBeNull()
  })

  it('says the upload card without a YouTube link', () => {
    expect(strings.landing.features[0].text).toBe('Upload your recording and sheet music.')
  })

  it('has one way to sign in: the Google button of the hero, 52 px high; the header has none', async () => {
    renderWithApp('/')

    const button = await screen.findByRole('button', { name: strings.landing.signInOrUp })
    expect(button.className).toMatch(/\bh-13\b/)
    // The film's own controls are the page's only other buttons.
    const outsideFilm = screen.getAllByRole('button').filter((each) => each.closest('[data-slot="landing-film"]') === null)
    expect(outsideFilm).toEqual([button])
    expect(within(screen.getByRole('banner')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('has a Practice Demo link beside it that goes to /demo, where the demo Practice opens', async () => {
    // The demo reads its files over the network, which tests never do: here they are not found.
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404 }))
    const { user, router } = renderWithApp('/')

    const link = await screen.findByRole('link', { name: strings.landing.practiceDemo })
    expect(link).toHaveAttribute('href', '/demo')
    expect(link.className).toMatch(/\bh-13\b/)
    await user.click(link)

    expect(router.state.location.pathname).toBe('/demo')
    expect(await screen.findByRole('link', { name: strings.demo.back })).toHaveAttribute('href', '/')
    vi.unstubAllGlobals()
  })

  it('puts the two buttons side by side from sm and one above the other below it', async () => {
    renderWithApp('/')

    const row = (await screen.findByRole('button', { name: strings.landing.signInOrUp })).parentElement!
    expect(row).toHaveClass('grid-cols-1')
    expect(row).toHaveClass('sm:grid-cols-2')
    expect(row).toContainElement(screen.getByRole('link', { name: strings.landing.practiceDemo }))
  })
})

describe('signing in', () => {
  it('takes a visitor to the terms, and from there to an empty library once they accept', async () => {
    const { user, router, fakes } = renderWithApp('/')

    await user.click(await screen.findByRole('button', { name: strings.landing.signInOrUp }))

    await waitFor(() => expect(pathNow(router)).toBe('/terms'))
    expect(await screen.findByRole('heading', { level: 1, name: strings.terms.gateTitle })).toBeInTheDocument()
    expect(await fakes.data.getUser()).not.toBeNull()

    const accept = screen.getByRole('button', { name: strings.terms.accept })
    expect(accept).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(accept).toBeEnabled()
    await user.click(accept)

    await waitFor(() => expect(pathNow(router)).toBe('/library'))
    expect(await screen.findByRole('heading', { level: 1, name: strings.library.title })).toBeInTheDocument()
    expect(await fakes.data.listPieces()).toEqual([])
  })

  it('goes straight to the library for someone who accepted the terms before', async () => {
    const { user, router, fakes } = renderWithApp('/')
    await fakes.data.signInWithGoogle()
    await fakes.data.acceptTerms()
    await fakes.data.signOut()
    await screen.findByRole('heading', { level: 1 })

    await user.click(screen.getByRole('button', { name: strings.landing.signInOrUp }))

    await waitFor(() => expect(pathNow(router)).toBe('/library'))
  })

  it('says so when sign-in fails, stays on the landing page and lets them try again', async () => {
    const { user, router, fakes } = renderWithApp('/')
    const signIn = fakes.data.signInWithGoogle
    fakes.data.signInWithGoogle = () => Promise.reject(new Error('popup closed'))
    const first = await screen.findByRole('button', { name: strings.landing.signInOrUp })

    await user.click(first)

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.landing.signInFailed)
    expect(pathNow(router)).toBe('/')
    expect(screen.getByRole('button', { name: strings.landing.signInOrUp })).toBeEnabled()

    fakes.data.signInWithGoogle = signIn
    await user.click(first)

    await waitFor(() => expect(pathNow(router)).toBe('/terms'))
  })

  it('says so, without a word of the error, when the profile of a signed-in user cannot be read', async () => {
    const fakes = createFakes({ signedIn: true })
    fakes.data.getProfile = () => Promise.reject(new Error('relation "profiles" does not exist'))

    const { router } = renderWithApp('/library', { fakes })

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.landing.signInFailed)
    expect(pathNow(router)).toBe('/')
    expect(screen.queryByText(/profiles/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.landing.signInOrUp })).toBeEnabled()
  })

  describe('when Google sends the visitor back with an error in the address', () => {
    afterEach(() => window.history.replaceState(null, '', '/'))

    it.each([
      ['a fragment', '/join/abc123#error=access_denied&error_code=bad&error_description=Secret+detail+from+Google'],
      ['a query string', '/library?error=access_denied&error_description=Secret+detail+from+Google'],
    ])('shows the usual failure sentence from %s, never the error text, and keeps the way back to a join link', async (_name, address) => {
      window.history.replaceState(null, '', address)

      const { router } = renderWithApp(address.split(/[?#]/)[0])

      expect(await screen.findByRole('alert')).toHaveTextContent(strings.landing.signInFailed)
      expect(screen.queryByText(/Secret detail|access_denied/)).not.toBeInTheDocument()
      expect(pathNow(router)).toBe('/')
      if (address.startsWith('/join/')) expect(router.state.location.search).toBe('?next=%2Fjoin%2Fabc123')
    })

    it('shows nothing when the address holds no error', async () => {
      renderWithApp('/library')
      await screen.findByRole('button', { name: strings.landing.signInOrUp })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('does not start a second sign-in while the first one is running', async () => {
    const { user, fakes } = renderWithApp('/')
    const signIn = fakes.data.signInWithGoogle
    let calls = 0
    let finish: () => void = () => {}
    fakes.data.signInWithGoogle = () => {
      calls += 1
      return new Promise((resolve) => (finish = () => resolve(signIn())))
    }
    const first = await screen.findByRole('button', { name: strings.landing.signInOrUp })

    await user.click(first)

    expect(first).toBeDisabled()
    expect(calls).toBe(1)
    finish()
    await waitFor(() => expect(screen.queryByRole('button', { name: strings.landing.signInOrUp })).not.toBeInTheDocument())
  })
})

describe('a user who is already signed in', () => {
  it('does not see the landing page', async () => {
    const { router } = renderWithApp('/', { signedIn: true, termsAccepted: true })

    await waitFor(() => expect(pathNow(router)).toBe('/library'))
  })
})
