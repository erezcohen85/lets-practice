import { screen, waitFor, within } from '@testing-library/react'
import { DEMO_USER } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { TERMS_VERSION } from '@/domain/terms'

const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname

describe('the terms gate, signed in without having accepted', () => {
  it('has the gate title as its one level-1 heading and says who is signed in', async () => {
    renderWithApp('/terms', { signedIn: true })

    const headings = await screen.findAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(strings.terms.gateTitle)
    expect(screen.getByText(DEMO_USER.email)).toHaveClass('font-medium')
    expect(screen.getByText(DEMO_USER.email).parentElement).toHaveTextContent(
      strings.terms.gateIntro.replace('{account}', DEMO_USER.email),
    )
  })

  it('shows the document title, the version line and every section, in a box that scrolls and can be reached by keyboard', async () => {
    renderWithApp('/terms', { signedIn: true })

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(box).toHaveAttribute('tabindex', '0')
    expect(box).toHaveClass('overflow-y-auto')
    expect(within(box).getByText(strings.terms.documentTitle)).toBeInTheDocument()
    expect(within(box).getByText(strings.terms.versionLine)).toBeInTheDocument()
    expect(strings.terms.sections).toHaveLength(15)
    for (const section of strings.terms.sections) {
      expect(within(box).getByRole('heading', { level: 2, name: section.heading })).toBeInTheDocument()
      // Every paragraph and every list item, each in its own element.
      for (const text of section.blocks.flat()) expect(within(box).getByText(text)).toBeInTheDocument()
    }
  })

  it('opens with the "In short" summary, before section 1, and says the sections are the terms', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    const summary = within(box).getByRole('region', { name: strings.terms.summaryTitle })
    expect(within(summary).getAllByRole('listitem').map((item) => item.textContent)).toEqual(strings.terms.summary)
    expect(within(summary).getByText(strings.terms.summaryNote)).toBeInTheDocument()
    const headings = within(box).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings[0]).toBe(strings.terms.summaryTitle)
    expect(headings[1]).toBe(strings.terms.sections[0].heading)
  })

  it('shows the lists as bulleted lists: what to upload, the three kinds of music to share, the Creative Commons rules and the notice contents', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    const lists = strings.terms.sections.flatMap((section) => section.blocks.filter((block) => typeof block !== 'string'))
    expect(lists).toHaveLength(4)
    for (const list of lists) {
      const item = within(box).getByText(list[0])
      expect(item.tagName).toBe('LI')
      expect(item.parentElement!.children).toHaveLength(list.length)
    }
  })

  it('keeps the document in a box about half the window high, so fifteen sections are not read through a slit', async () => {
    renderWithApp('/terms', { signedIn: true })

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    // jsdom has no layout, so the classes are what can be checked: half the window, with a floor on a short window.
    expect(box).toHaveClass('h-[50dvh]', 'min-h-64')
    expect(box).not.toHaveClass('h-40')
  })

  it('says in section 6 who sees whose name and email, and keeps the version', async () => {
    renderWithApp('/terms', { signedIn: true })

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(within(box).getByText(/they cannot change it\. The owner of a piece sees the name and email of everyone who joined it, and people who join see the owner's name\. You can turn the link off/)).toBeInTheDocument()
    expect(strings.terms.versionLine).toContain(TERMS_VERSION)
  })

  it('says in section 6 that turning the link off keeps the people who joined, as the app does (spec step 4: B keeps access)', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(within(box).getByText(/Turning the link off or making a new one stops new people from joining; people who already joined keep access until you remove them or delete the piece\./)).toBeInTheDocument()
  })

  it('says in section 6, after turning the link off, that a piece has a member limit and what happens at it', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(
      within(box).getByText(
        /keep access until you remove them or delete the piece\. A piece has a limit on how many people can join it\. When it is full, new people cannot join; if the limit goes down, the people who joined last are put on hold until there is room\.$/,
      ),
    ).toBeInTheDocument()
  })

  it('makes the share statement cover the score and the recording separately, as section 5 of the terms', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    // The three words of the share dialog's question, each defined.
    expect(strings.share.rightsBody).toBe('Please confirm that this piece is your own music, in the public domain, or used with permission.')
    expect(within(box).getByText(/It covers the score and the recording separately/)).toBeInTheDocument()
    for (const term of [/^Your own music:/, /^In the public domain:/, /^Used with permission:/]) expect(within(box).getByText(term).tagName).toBe('LI')
  })

  it('treats every Creative Commons family precisely: BY and BY-SA share, NC only non-commercially, ND never shared, SA passes on its licence', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(within(box).getByText(/music synced to moving images is an adaptation\. A score with a cursor moving in time with the recording may count as one, so these terms treat a shared piece as one/)).toBeInTheDocument()
    expect(within(box).getByText(/^CC BY and CC BY-SA: you may share the piece/)).toBeInTheDocument()
    expect(within(box).getByText(/^CC BY-NC and CC BY-NC-SA: you may share the piece only for use that is not mainly aimed at commercial advantage/)).toBeInTheDocument()
    expect(within(box).getByText(/^CC BY-ND and CC BY-NC-ND: you may not share the piece\./)).toBeInTheDocument()
    expect(within(box).getByText(/^ShareAlike \(SA\): when you share, your own additions/)).toBeInTheDocument()
    expect(within(box).getByText(/^Credit\. .*the name of the licence with a link to it, any copyright notice that came with the material, and a note saying how you changed it/)).toBeInTheDocument()
  })

  it('sets out the complaint process: what a notice holds, removal for everyone it was shared with, the answer, repeat infringers and false notices', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    const notice = strings.terms.sections.find((section) => section.heading === '9. Copyright complaints.')!
    expect(notice.blocks[1]).toHaveLength(6)
    expect(within(box).getByText(/we promptly remove the material, or the access of everyone it was shared with/)).toBeInTheDocument()
    expect(within(box).getByText(/Unless they tell us that they have started legal action, we may restore the material 10 to 14 working days after we received your answer/)).toBeInTheDocument()
    expect(within(box).getByText(/^Repeat infringement\. We close the accounts of people who repeatedly share material/)).toBeInTheDocument()
    expect(within(box).getByText(/^False notices\./)).toBeInTheDocument()
    expect(within(box).getByText(/a person handles every report/)).toBeInTheDocument()
  })

  it('states the open trial and its plan limits in section 10, and that the pieces you have stay if a plan changes', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    const access = strings.terms.sections.find((section) => section.heading === '10. Upload access.')!
    expect(access.blocks.every((block) => typeof block === 'string')).toBe(true)
    expect(within(box).getByText(/^Anyone who signs in can try the app on the Trial plan\. A plan has limits/)).toBeInTheDocument()
    expect(within(box).getByText(/we can change a plan, or the limits of a plan, at any time/)).toBeInTheDocument()
    expect(within(box).getByText(/Deleting a piece does not give back a piece you made on the Trial plan/)).toBeInTheDocument()
    expect(within(box).getByText(/the pieces and shares you already have stay/)).toBeInTheDocument()
    expect(JSON.stringify(access)).not.toMatch(/limited to creators|Uploading new pieces is limited/)
  })

  it('says in the data section that deleting an account keeps a one-way hash of the email and the count of trial pieces, nothing more', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    const data = strings.terms.sections.find((section) => section.heading === '13. Your data.')!
    expect(within(box).getByText(/^Deleting your account\. When you delete your account, we keep one thing: a one-way hash of your email address, which cannot be turned back into the address, and the number of Trial pieces you made\. We keep it so that a new account with the same email does not start a new trial\./)).toBeInTheDocument()
    expect(data.blocks).toHaveLength(2)
  })

  it('keeps consumer rights and liability that cannot be limited, and names the courts of Israel', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(within(box).getByText(/takes away rights you have as a consumer under the law that protects you/)).toBeInTheDocument()
    expect(within(box).getByText(/the courts of Israel decide disputes about them, unless the law that protects you as a consumer lets you go to court where you live/)).toBeInTheDocument()
  })

  it('gives the contact address, the processor and the country of the law that the terms name', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(within(box).getAllByText(/lets\.practice\.app@gmail\.com/).length).toBeGreaterThan(0)
    expect(within(box).getByText(/governed by the law of Israel/)).toBeInTheDocument()
    expect(within(box).getByText(/Railway \(processing, in the EU\)/)).toBeInTheDocument()
  })

  it('says in section 13 that the Google picture is stored, and that the account is deleted in Settings, keeping the contact for anything else', async () => {
    renderWithApp('/terms')

    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(within(box).getByText(/Google name, email address and profile picture/)).toBeInTheDocument()
    expect(within(box).getByText(/delete your account and all your content yourself in Settings, under Account\. For anything else about your data, write to lets\.practice\.app@gmail\.com/)).toBeInTheDocument()
    expect(within(box).queryByText(/To delete your account and your content, write to/)).not.toBeInTheDocument()
  })

  it('keeps Accept and continue disabled until the box is ticked', async () => {
    const { user } = renderWithApp('/terms', { signedIn: true })
    const checkbox = await screen.findByRole('checkbox', { name: /I have read and accept the terms of use/ })
    const accept = screen.getByRole('button', { name: strings.terms.accept })

    expect(checkbox).not.toBeChecked()
    expect(accept).toBeDisabled()

    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    expect(accept).toBeEnabled()

    await user.click(checkbox)
    expect(accept).toBeDisabled()
  })

  it('ticks the box from its label text too', async () => {
    const { user } = renderWithApp('/terms', { signedIn: true })
    const checkbox = await screen.findByRole('checkbox')

    await user.click(screen.getByText(/I have read and accept the/))

    expect(checkbox).toBeChecked()
  })

  it('links the words "terms of use" to the box', async () => {
    renderWithApp('/terms', { signedIn: true })

    const link = await screen.findByRole('link', { name: strings.terms.acceptLink })
    const box = screen.getByRole('region', { name: strings.terms.boxLabel })
    expect(link).toHaveAttribute('href', `#${box.id}`)
    expect(box.id).not.toBe('')
  })

  it('saves the acceptance and opens the library', async () => {
    const { user, router, fakes } = renderWithApp('/terms', { signedIn: true })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: strings.terms.accept }))

    await waitFor(() => expect(pathNow(router)).toBe('/library'))
    expect((await fakes.data.getProfile()).acceptedTermsAt).not.toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: strings.library.title })).toBeInTheDocument()
  })

  it('says so when the acceptance cannot be saved, and stays here', async () => {
    const { user, router, fakes } = renderWithApp('/terms', { signedIn: true })
    fakes.data.acceptTerms = () => Promise.reject(new Error('offline'))

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: strings.terms.accept }))

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.terms.acceptFailed)
    expect(pathNow(router)).toBe('/terms')
    expect(screen.getByRole('button', { name: strings.terms.accept })).toBeEnabled()
  })

  it('signs out and goes back to the landing page', async () => {
    const { user, router, fakes } = renderWithApp('/terms', { signedIn: true })

    await user.click(await screen.findByRole('button', { name: strings.terms.signOut }))

    await waitFor(() => expect(pathNow(router)).toBe('/'))
    expect(await screen.findByRole('heading', { level: 1, name: strings.landing.headline.join(' ') })).toBeInTheDocument()
    expect(await fakes.data.getUser()).toBeNull()
  })

  it.each([
    ['signing out', strings.terms.signOut, false],
    ['accepting', strings.terms.accept, true],
  ])('keeps the gate as it is while %s, with no flash of another view', async (_, buttonName, tick) => {
    const { user, router } = renderWithApp('/terms', { signedIn: true })
    await screen.findByRole('heading', { level: 1, name: strings.terms.gateTitle })
    const headings: string[] = []
    const observer = new MutationObserver(() => {
      const heading = document.querySelector('h1')?.textContent
      if (heading && headings.at(-1) !== heading) headings.push(heading)
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    if (tick) await user.click(screen.getByRole('checkbox'))

    await user.click(screen.getByRole('button', { name: buttonName }))
    await waitFor(() => expect(pathNow(router)).not.toBe('/terms'))
    await waitFor(() => expect(document.querySelector('h1')?.textContent).not.toBe(strings.terms.gateTitle))
    observer.disconnect()

    expect(headings).not.toContain(strings.terms.title)
  })

  it('opens the path in next after accepting', async () => {
    const { user, router } = renderWithApp('/terms?next=/join/abc', { signedIn: true })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: strings.terms.accept }))

    await waitFor(() => expect(pathNow(router)).toBe('/join/abc'))
  })

  it('has buttons of at least 44 px', async () => {
    renderWithApp('/terms', { signedIn: true })

    for (const name of [strings.terms.accept, strings.terms.signOut]) {
      expect((await screen.findByRole('button', { name })).className).toMatch(/\bh-(11|12|13)\b/)
    }
  })
})

describe('the terms page, signed out', () => {
  it('shows the terms and a way to sign in, and no accept controls', async () => {
    renderWithApp('/terms')

    expect(await screen.findByRole('heading', { level: 1, name: strings.terms.title })).toBeInTheDocument()
    expect(screen.getByText(strings.terms.visitorIntro)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: strings.terms.boxLabel })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.terms.signInOrUp })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.terms.back })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.terms.accept })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.terms.signOut })).not.toBeInTheDocument()
  })

  it("puts the landing page's white Google button and a Back button side by side in one row, both 52 px high", async () => {
    renderWithApp('/terms')

    const google = await screen.findByRole('button', { name: strings.terms.signInOrUp })
    const back = screen.getByRole('button', { name: strings.terms.back })
    expect(strings.terms.signInOrUp).toBe(strings.landing.signInOrUp)
    // The four-colour G of GoogleSignInButton, hidden from assistive technology.
    expect(google.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(google.querySelectorAll('svg path')).toHaveLength(4)
    expect(google.parentElement).toBe(back.parentElement)
    expect(google.parentElement).toHaveClass('flex', 'flex-wrap')
    for (const button of [google, back]) expect(button).toHaveClass('h-13')
  })

  it('goes back to the page the visitor came from', async () => {
    const { user, router } = renderWithApp('/')

    await user.click((await screen.findAllByRole('link', { name: strings.landing.terms }))[0])
    await waitFor(() => expect(pathNow(router)).toBe('/terms'))
    await user.click(await screen.findByRole('button', { name: strings.terms.back }))

    await waitFor(() => expect(pathNow(router)).toBe('/'))
  })

  it('goes to the landing page when /terms was opened directly', async () => {
    const { user, router } = renderWithApp('/terms')

    await user.click(await screen.findByRole('button', { name: strings.terms.back }))

    await waitFor(() => expect(pathNow(router)).toBe('/'))
  })

  it('links the logo back to the landing page', async () => {
    renderWithApp('/terms')

    expect(await screen.findByRole('link', { name: strings.app.name })).toHaveAttribute('href', '/')
  })

  it('stays on /terms after signing in and then asks for the acceptance', async () => {
    const { user, router } = renderWithApp('/terms')

    await user.click(await screen.findByRole('button', { name: strings.terms.signInOrUp }))

    expect(await screen.findByRole('heading', { level: 1, name: strings.terms.gateTitle })).toBeInTheDocument()
    expect(pathNow(router)).toBe('/terms')
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('says so when sign-in fails', async () => {
    const { user, fakes } = renderWithApp('/terms')
    fakes.data.signInWithGoogle = () => Promise.reject(new Error('popup closed'))

    await user.click(await screen.findByRole('button', { name: strings.terms.signInOrUp }))

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.terms.signInFailed)
    expect(screen.getByRole('button', { name: strings.terms.signInOrUp })).toBeEnabled()
  })
})

describe('the terms page, signed in with the terms accepted', () => {
  it('shows the terms and a way back to the library, and asks for nothing', async () => {
    renderWithApp('/terms', { signedIn: true, termsAccepted: true })

    expect(await screen.findByRole('heading', { level: 1, name: strings.terms.title })).toBeInTheDocument()
    expect(screen.getByText(strings.terms.acceptedIntro)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: strings.terms.boxLabel })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: strings.common.goToLibrary })).toHaveAttribute('href', '/library')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.terms.accept })).not.toBeInTheDocument()
  })

  it('links the logo to the library', async () => {
    renderWithApp('/terms', { signedIn: true, termsAccepted: true })

    expect(await screen.findByRole('link', { name: strings.app.name })).toHaveAttribute('href', '/library')
  })
})
