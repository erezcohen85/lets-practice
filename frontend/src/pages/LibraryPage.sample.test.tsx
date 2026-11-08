import { StrictMode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createFakes } from '@/lib/fakes'
import { FAKE_SAMPLE_TITLE } from '@/lib/fakes/fakeSample'
import { DEMO_USER } from '@/lib/fakes/store'
import { SampleFailedError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { trialFakes } from '@/test/planFixtures'
import { renderWithApp } from '@/test/render'

// The sample piece in the Library: asked for once after the first list load, its card says "Sample" in words.

// A busy machine runs the whole suite slowly; the default second is not always enough.
const LOADED = { timeout: 5000 }

describe('Library: the sample piece', () => {
  it('asks for the sample once when the account has not been asked, then lists the new piece without a reload, labelled', async () => {
    const fakes = createFakes({ seed: 'empty', signedIn: true, termsAccepted: true })
    const claim = vi.spyOn(fakes.processor, 'claimSamplePiece')

    renderWithApp('/library', { fakes, sampleUnasked: true })

    expect(await screen.findByText(FAKE_SAMPLE_TITLE, undefined, LOADED)).toBeInTheDocument()
    expect(screen.getByText(strings.library.sampleLabel)).toBeInTheDocument()
    expect(strings.library.sampleLabel).toBe('Sample')
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('does not ask when the account has been asked before', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.store.profiles.get(DEMO_USER.id)!.sampleGivenAt = '2026-11-01T09:00:00.000Z'
    const claim = vi.spyOn(fakes.processor, 'claimSamplePiece')

    renderWithApp('/library', { fakes })

    await screen.findByText('Clark County Celebration', undefined, LOADED)
    expect(claim).not.toHaveBeenCalled()
    expect(screen.queryByText(strings.library.sampleLabel)).not.toBeInTheDocument()
  })

  it('shows the other pieces and no error when the claim fails, warns, and does not retry in the visit', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const claim = vi.spyOn(fakes.processor, 'claimSamplePiece').mockRejectedValue(new SampleFailedError())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderWithApp('/library', { fakes, sampleUnasked: true })

    await screen.findByText('Clark County Celebration', undefined, LOADED)
    await waitFor(() => expect(warn).toHaveBeenCalled(), LOADED)
    expect(screen.queryByText(strings.library.errorTitle)).not.toBeInTheDocument()
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('does not take a "skipped" answer for a mark: the next visit asks again', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const claim = vi.spyOn(fakes.processor, 'claimSamplePiece').mockResolvedValue({ status: 'skipped' })

    const first = renderWithApp('/library', { fakes, sampleUnasked: true })
    await screen.findByText('Clark County Celebration', undefined, LOADED)
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1), LOADED)
    expect((await fakes.data.getProfile()).sampleGivenAt).toBeNull()
    first.unmount()

    renderWithApp('/library', { fakes, sampleUnasked: true })
    await screen.findByText('Clark County Celebration', undefined, LOADED)
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2), LOADED)
  })

  it('asks only once under strict mode, which runs the effect twice', async () => {
    const fakes = createFakes({ seed: 'empty', signedIn: true, termsAccepted: true })
    const claim = vi.spyOn(fakes.processor, 'claimSamplePiece')

    renderWithApp('/library', { fakes, sampleUnasked: true, wrap: (children) => <StrictMode>{children}</StrictMode> })

    expect(await screen.findByText(FAKE_SAMPLE_TITLE, undefined, LOADED)).toBeInTheDocument()
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('counts the sample in the usage line, which is read again after it is given', async () => {
    renderWithApp('/library', { fakes: await trialFakes(0), sampleUnasked: true })

    expect(await screen.findByText(strings.plans.usedLine(1, 3, 'Trial'), undefined, LOADED)).toBeInTheDocument()
  })
})
