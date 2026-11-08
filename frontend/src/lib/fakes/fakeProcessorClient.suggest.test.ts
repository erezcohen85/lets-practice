import { createFakes } from '@/lib/fakes'

const file = (name: string) => new File(['x'], name)

describe('the fake processor client: suggesting a name', () => {
  it('names a piece that exists from its title', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    const suggestion = await processor.suggestPieceName('piece-clark-county')

    expect(suggestion.source).toBe('claude')
    expect(suggestion.name).not.toBe('')
  })

  it('names a form from the audio file chosen, read as words', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    const suggestion = await processor.suggestNewPieceName({ recording: { kind: 'file', file: file('Los_Banditos-2019.mp3') }, firstPart: null })

    expect(suggestion).toEqual({ name: 'Los Banditos 2019', source: 'claude', note: null })
  })

  it('says it is the fallback, and why, for a name the test marks so', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    const suggestion = await processor.suggestNewPieceName({ recording: { kind: 'file', file: file('nokey.mp3') }, firstPart: null })

    expect(suggestion.source).toBe('fallback')
    expect(suggestion.note).toContain('no Anthropic API key')
  })

  it('has an empty name and a note when there is nothing to go on', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    const suggestion = await processor.suggestNewPieceName({ recording: null, firstPart: null })

    expect(suggestion.name).toBe('')
    expect(suggestion.note).not.toBeNull()
  })

  it('needs a signed-in user', async () => {
    const { processor } = createFakes()

    await expect(processor.suggestNewPieceName({ recording: null, firstPart: null })).rejects.toThrow('not signed in')
  })
})
