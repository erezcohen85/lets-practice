import { partNameFromFile, validateNewParts, validateNewPiece, validateSplitParts, type NewPieceForm } from '@/domain/newPiece'

function form(overrides: Partial<NewPieceForm> = {}): NewPieceForm {
  return {
    title: 'Clark County Celebration',
    recording: { kind: 'file', fileName: 'take-3.mp3' },
    parts: [{ fileName: 'clarinet.pdf', name: 'Clarinet in B♭ 1' }],
    ...overrides,
  }
}

describe('validateNewPiece', () => {
  it('has no errors for a valid form with an audio file', () => {
    expect(validateNewPiece(form())).toEqual({})
  })

  it('has no errors for a valid form with an audio file and several parts', () => {
    const result = validateNewPiece(
      form({
        recording: { kind: 'file', fileName: 'take-3.mp3' },
        parts: [
          { fileName: 'clarinet.pdf', name: 'Clarinet' },
          { fileName: 'FLUTE.PDF', name: 'Flute' },
        ],
      }),
    )

    expect(result).toEqual({})
  })

  it('reports a missing title, also when it is only spaces', () => {
    expect(validateNewPiece(form({ title: '' }))).toEqual({ title: 'title-missing' })
    expect(validateNewPiece(form({ title: '   ' }))).toEqual({ title: 'title-missing' })
  })

  it('reports a missing audio file, also an empty name', () => {
    expect(validateNewPiece(form({ recording: { kind: 'file', fileName: null } }))).toEqual({
      recording: 'recording-missing',
    })
    expect(validateNewPiece(form({ recording: { kind: 'file', fileName: '' } }))).toEqual({
      recording: 'recording-missing',
    })
  })

  it('reports a form with no parts', () => {
    expect(validateNewPiece(form({ parts: [] }))).toEqual({ parts: 'parts-missing' })
  })

  it('does not ask for a part name: left empty, it is read from the PDF or made from the file name', () => {
    const result = validateNewPiece(
      form({
        parts: [
          { fileName: 'clarinet.pdf', name: 'Clarinet' },
          { fileName: 'flute.pdf', name: '  ' },
        ],
      }),
    )

    expect(result).toEqual({})
  })

  it('reports a part whose file is not a PDF', () => {
    const result = validateNewPiece(
      form({
        parts: [
          { fileName: 'clarinet.pdf', name: 'Clarinet' },
          { fileName: 'notes.txt', name: 'Flute' },
          { fileName: 'scan', name: 'Oboe' },
        ],
      }),
    )

    expect(result).toEqual({ 'part-1': 'part-not-pdf', 'part-2': 'part-not-pdf' })
  })

  it('reports a part that is not a PDF whether or not it has a name', () => {
    expect(validateNewPiece(form({ parts: [{ fileName: 'notes.txt', name: '' }] }))).toEqual({
      'part-0': 'part-not-pdf',
    })
  })

  it('reports every problem at once, keyed by field', () => {
    const result = validateNewPiece({
      title: '',
      recording: { kind: 'file', fileName: null },
      parts: [{ fileName: 'a.txt', name: '' }],
    })

    expect(result).toEqual({
      title: 'title-missing',
      recording: 'recording-missing',
      'part-0': 'part-not-pdf',
    })
  })

  it('does not change the form', () => {
    const input = form({ title: '' })
    const copy = structuredClone(input)

    validateNewPiece(input)

    expect(input).toEqual(copy)
  })
})

describe('validateNewParts', () => {
  it('has no errors for PDFs that each have a name', () => {
    expect(validateNewParts([{ fileName: 'clarinet.pdf', name: 'Clarinet' }, { fileName: 'FLUTE.PDF', name: 'Flute' }])).toEqual({})
  })

  it('asks for at least one PDF', () => {
    expect(validateNewParts([])).toEqual({ parts: 'parts-missing' })
  })

  it('refuses a file that is not a PDF, per row, and does not ask for names', () => {
    expect(
      validateNewParts([
        { fileName: 'a.pdf', name: '   ' },
        { fileName: 'notes.txt', name: 'Notes' },
        { fileName: 'c.pdf', name: 'Cello' },
      ]),
    ).toEqual({ 'part-1': 'part-not-pdf' })
  })

  it('says what validateNewPiece says of the same parts', () => {
    const parts = [{ fileName: 'a.pdf', name: '' }, { fileName: 'b.png', name: 'B' }]
    const ofPiece = Object.entries(validateNewPiece(form({ parts }))).filter(([field]) => field.startsWith('part-'))
    expect(validateNewParts(parts)).toEqual(Object.fromEntries(ofPiece))
  })
})

describe('partNameFromFile', () => {
  it('drops the extension and turns underscores and dashes into spaces', () => {
    expect(partNameFromFile('CCC_clar1_final-v2.pdf')).toBe('CCC clar1 final v2')
  })

  it('drops an upper-case extension', () => {
    expect(partNameFromFile('Flute 1.PDF')).toBe('Flute 1')
  })

  it('collapses runs of spaces and separators and trims the ends', () => {
    expect(partNameFromFile('__Trumpet  in   B♭ 2__.pdf')).toBe('Trumpet in B♭ 2')
    expect(partNameFromFile('a--b__c.pdf')).toBe('a b c')
  })

  it('keeps a dot inside the name and drops only the last extension', () => {
    expect(partNameFromFile('Score v1.2.pdf')).toBe('Score v1.2')
    expect(partNameFromFile('Etude No. 4.pdf')).toBe('Etude No. 4')
  })

  it('keeps a name that has no extension', () => {
    expect(partNameFromFile('Clarinet_1')).toBe('Clarinet 1')
  })

  it('gives an empty name for a file with nothing but an extension', () => {
    expect(partNameFromFile('.pdf')).toBe('')
  })
})

describe('validateSplitParts', () => {
  const part = (name: string, keep = true) => ({ name, fromPage: 1, toPage: 1, keep, skipPages: [] })

  it('asks for the split to be confirmed first', () => {
    expect(validateSplitParts(false, [part('Flute')])).toEqual({ parts: 'parts-missing' })
  })

  it('is fine once confirmed with a part to keep', () => {
    expect(validateSplitParts(true, [part('Flute')])).toEqual({})
  })

  it('is not fine when nothing is kept or a kept part has no name', () => {
    expect(validateSplitParts(true, [part('Flute', false)])).toEqual({ parts: 'parts-missing' })
    expect(validateSplitParts(true, [part(' ')])).toEqual({ parts: 'parts-missing' })
  })
})
