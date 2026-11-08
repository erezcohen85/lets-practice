import { type StepKind, type StepLabel } from '@/domain/history'
import { barNamesOf } from '@/domain/barNames'
import { PLAN_LIMITS, type LimitKey, type PlanRow } from '@/domain/planLimits'
import { barWithPass, redoTooltip, stepText, strings, undoTooltip } from '@/strings'

// A record keyed by StepKind, so adding a kind to the domain without a phrase test here fails the typecheck.
const LABEL_BY_KIND: Record<StepKind, StepLabel> = {
  'add-bar-line': { kind: 'add-bar-line', bar: 12 },
  'delete-bar-line': { kind: 'delete-bar-line', bar: 12 },
  'move-bar-line': { kind: 'move-bar-line', bar: 12 },
  'move-line-start': { kind: 'move-line-start', bar: 12 },
  'move-line-end': { kind: 'move-line-end', bar: 12 },
  'insert-piece-bar': { kind: 'insert-piece-bar', bar: 23 },
  'remove-piece-bar': { kind: 'remove-piece-bar', bar: 23 },
  'set-bars-in-box': { kind: 'set-bars-in-box', bar: 101, count: 4 },
  'add-piece-bar-line': { kind: 'add-piece-bar-line', bar: 40 },
  'delete-piece-bar-line': { kind: 'delete-piece-bar-line', bar: 40 },
  'set-piece-bars-in-box': { kind: 'set-piece-bars-in-box', bar: 101, count: 4 },
  'set-structure': { kind: 'set-structure' },
  'add-locator': { kind: 'add-locator', bar: 12 },
  'delete-locator': { kind: 'delete-locator', bar: 12 },
  'move-locator': { kind: 'move-locator', bar: 12 },
  'move-locators': { kind: 'move-locators', count: 3 },
  regrid: { kind: 'regrid' },
  'sounds-right': { kind: 'sounds-right', bar: 12 },
  resolved: { kind: 'resolved', bar: 12 },
  'undo-move': { kind: 'undo-move', bar: 12 },
  'relabel-locator': { kind: 'relabel-locator', bar: 12 },
  'resolve-all': { kind: 'resolve-all' },
  'edit-meters': { kind: 'edit-meters' },
  'edit-play-order': { kind: 'edit-play-order' },
  'relabel-in-order': { kind: 'relabel-in-order', count: 5 },
  'edit-marks': { kind: 'edit-marks' },
  'edit-short-bars': { kind: 'edit-short-bars' },
  'toggle-pickup': { kind: 'toggle-pickup' },
  'add-pickup-bar': { kind: 'add-pickup-bar', bar: 7 },
  'remove-pickup-bar': { kind: 'remove-pickup-bar', bar: 7 },
  'set-pickup-length': { kind: 'set-pickup-length', bar: 7 },
  'split-part-pickup': { kind: 'split-part-pickup', bar: 0 },
  'shift-part-pickup': { kind: 'shift-part-pickup', bar: 0 },
  realign: { kind: 'realign' },
  'fill-bars': { kind: 'fill-bars' },
  'resolve-box-flag': { kind: 'resolve-box-flag', bar: 12 },
}

const PLAIN = barNamesOf(undefined)
// internal bar 7 is a pickup with no number: it reads p7, and the bar after it reads 7
const WITH_PICKUP = barNamesOf([{ bar: 7, units: 2, unnumbered: true }])

describe('the sections of strings', () => {
  it('has one section per screen of Phase 4 after the shell sections, in the plan order', () => {
    const phase4 = ['common', 'landing', 'terms', 'library', 'newPiece', 'processing', 'hub', 'settings']
    const keys = Object.keys(strings)

    expect(keys.filter((key) => phase4.includes(key))).toEqual(phase4)
    expect(keys.indexOf('common')).toBeGreaterThan(keys.indexOf('history'))
  })
})

describe('a pickup bar with no number in the sentences', () => {
  it('names the bar by its label, never by its internal number', () => {
    expect(stepText({ kind: 'move-locator', bar: 7 }, WITH_PICKUP)).toBe('move locator for bar p7')
    expect(stepText({ kind: 'move-locator', bar: 8, passIndex: 1 }, WITH_PICKUP)).toBe('move locator for bar 7 (2)')
    expect(undoTooltip({ kind: 'add-pickup-bar', bar: 7 }, WITH_PICKUP)).toBe('Undo: add pickup bar p7')
    expect(redoTooltip({ kind: 'remove-pickup-bar', bar: 7 }, WITH_PICKUP)).toBe('Redo: remove pickup bar p7')
    expect(stepText({ kind: 'set-bars-in-box', bar: 7, count: 1 }, WITH_PICKUP)).toBe('make bar p7 one bar')
    expect(stepText({ kind: 'resolved', bar: 7, passIndex: 1 }, WITH_PICKUP)).toBe('resolve bar p7 (2)')
  })

  it('reads the top pickup (bar 0) as p1', () => {
    expect(stepText({ kind: 'add-locator', bar: 0 }, barNamesOf([{ bar: 0, units: 1 }]))).toBe('add locator for bar p1')
  })
})

describe('barWithPass', () => {
  it('writes the bar alone on the first pass', () => {
    expect(barWithPass('12')).toBe('12')
    expect(barWithPass('12', 0)).toBe('12')
  })

  it('adds the pass number in brackets on later passes', () => {
    expect(barWithPass('12', 1)).toBe('12 (2)')
    expect(barWithPass('3', 2)).toBe('3 (3)')
  })
})

describe('stepText', () => {
  it.each([
    [{ kind: 'add-bar-line', bar: 12 }, 'add bar line after bar 12'],
    [{ kind: 'delete-bar-line', bar: 12 }, 'delete bar line after bar 12'],
    [{ kind: 'move-bar-line', bar: 12 }, 'move bar line after bar 12'],
    [{ kind: 'insert-piece-bar', bar: 23 }, 'insert bar 23 in the piece'],
    [{ kind: 'set-bars-in-box', bar: 101, count: 4 }, 'make bar 101 a 4-bar rest'],
    [{ kind: 'set-bars-in-box', bar: 18, count: 1 }, 'make bar 18 one bar'],
    [{ kind: 'set-piece-bars-in-box', bar: 101, count: 4 }, 'make bar 101 a 4-bar rest in the piece'],
    [{ kind: 'add-piece-bar-line', bar: 40 }, 'add bar line after bar 40 in the piece'],
    [{ kind: 'remove-piece-bar', bar: 23 }, 'remove bar 23 from the piece'],
    [{ kind: 'insert-piece-bar' }, 'insert bar in the piece'],
    [{ kind: 'remove-piece-bar' }, 'remove bar from the piece'],
    [{ kind: 'add-locator', bar: 12 }, 'add locator for bar 12'],
    [{ kind: 'delete-locator', bar: 12 }, 'delete locator for bar 12'],
    [{ kind: 'move-locator', bar: 12 }, 'move locator for bar 12'],
    [{ kind: 'move-locators', count: 3 }, 'move 3 locators'],
    [{ kind: 'move-locators' }, 'move locators'],
    [{ kind: 'regrid' }, 'put bar lines on the beats'],
    [{ kind: 'move-locator', bar: 12, passIndex: 1 }, 'move locator for bar 12 (2)'],
    [{ kind: 'sounds-right', bar: 12, passIndex: 1 }, 'mark bar 12 (2) as sounds right'],
    [{ kind: 'resolved', bar: 12 }, 'resolve bar 12'],
    [{ kind: 'undo-move', bar: 12, passIndex: 2 }, 'undo move of bar 12 (3)'],
    [{ kind: 'relabel-locator', bar: 12, passIndex: 1 }, 'relabel locator of bar 12 (2)'],
    [{ kind: 'resolve-all' }, 'resolve all'],
    [{ kind: 'edit-meters' }, 'edit meters'],
    [{ kind: 'edit-play-order' }, 'edit play order'],
    [{ kind: 'relabel-in-order', count: 205 }, 'relabel 205 locators in play order'],
    [{ kind: 'relabel-in-order', count: 1 }, 'relabel 1 locator in play order'],
    [{ kind: 'relabel-in-order' }, 'relabel the locators in play order'],
    [{ kind: 'edit-marks' }, 'edit marks'],
    [{ kind: 'realign' }, 'realign'],
    [{ kind: 'fill-bars' }, 'fill the empty bars'],
    [{ kind: 'resolve-box-flag', bar: 12 }, 'resolve the box flag on bar 12'],
    [{ kind: 'resolve-box-flag' }, 'resolve the box flag'],
  ] satisfies [StepLabel, string][])('turns %j into "%s"', (label, text) => {
    expect(stepText(label, PLAIN)).toBe(text)
  })

  it('does not put the pass on a bar-line step: the line sits after the bar', () => {
    expect(stepText({ kind: 'add-bar-line', bar: 12, passIndex: 1 }, PLAIN)).toBe('add bar line after bar 12')
  })

  it.each(Object.values(LABEL_BY_KIND))('gives a clean phrase for $kind', (label) => {
    const text = stepText(label, PLAIN)

    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
  })

  it('gives a clean phrase for the bar steps when the bar is missing', () => {
    for (const label of Object.values(LABEL_BY_KIND)) {
      const text = stepText({ kind: label.kind }, PLAIN)

      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain('undefined')
      expect(text).not.toContain('NaN')
    }
  })
})

describe('undoTooltip and redoTooltip', () => {
  it('say there is nothing to undo or redo for a null label', () => {
    expect(undoTooltip(null, PLAIN)).toBe('Nothing to undo')
    expect(redoTooltip(null, PLAIN)).toBe('Nothing to redo')
    expect(undoTooltip(null, PLAIN)).toBe(strings.history.nothingToUndo)
    expect(redoTooltip(null, PLAIN)).toBe(strings.history.nothingToRedo)
  })

  it('name the step', () => {
    expect(undoTooltip({ kind: 'add-bar-line', bar: 12 }, PLAIN)).toBe('Undo: add bar line after bar 12')
    expect(redoTooltip({ kind: 'add-bar-line', bar: 12 }, PLAIN)).toBe('Redo: add bar line after bar 12')
    expect(undoTooltip({ kind: 'move-locator', bar: 12, passIndex: 1 }, PLAIN)).toBe('Undo: move locator for bar 12 (2)')
    expect(redoTooltip({ kind: 'realign' }, PLAIN)).toBe('Redo: realign')
  })

  it('use the button words from strings.history', () => {
    expect(strings.history.undo).toBe('Undo')
    expect(strings.history.redo).toBe('Redo')
  })
})

describe('the status sentence of a bar-line shift', () => {
  const back = { first: '31', last: '56', count: 26, direction: 'back' } as const

  it('says which bars moved and which was filled from the recording', () => {
    expect(strings.editor.status.shifted(back, { first: '56', last: '56', count: 1 })).toBe('Bars 31 to 56 moved one bar back; bar 56 filled from the recording.')
  })

  it('says it with one moved bar, several filled bars, or nothing filled', () => {
    expect(strings.editor.status.shifted({ ...back, first: '56', count: 1 }, null)).toBe('Bar 56 moved one bar back.')
    expect(strings.editor.status.shifted({ ...back, direction: 'forward' }, { first: '55', last: '56', count: 2 })).toBe(
      'Bars 31 to 56 moved one bar forward; bars 55 to 56 filled from the recording.',
    )
  })
})

describe('the status sentence of a relabel in play order', () => {
  it('says how many locators took a new label, and that their times did not move', () => {
    expect(strings.editor.status.relabeled(205)).toBe(
      '205 locators were relabelled to follow the play order. Their times did not move. Relabelled ones are unchecked again.',
    )
    expect(strings.editor.status.relabeled(1)).toBe('1 locator was relabelled to follow the play order. Its time did not move. It is unchecked again.')
  })
})

describe('the plan prompt copy (the prototype\'s Prompt copy sticky)', () => {
  const trial = {
    id: 'trial', name: 'Trial', position: 0, pieces_created_max: 3, pieces_stored_max: 3, parts_per_piece_max: 1, pages_per_part_max: 20, recording_minutes_max: 10,
    advanced_reading: false, advanced_reading_parts_per_month: 0, split_pdf: false, suggest_name: true, shared_pieces_max: 1, members_per_piece: 30, members_per_part: 10,
    read_again_per_part_max: 2, realign_per_piece_max: 5, new_pieces_per_day: 20, new_pieces_paused: false,
  } satisfies PlanRow
  const prompt = (limit: LimitKey, plan: PlanRow = trial) => strings.plans.prompt[limit](plan)

  it('has a sentence for every limit key, in the plan\'s name', () => {
    for (const { key } of PLAN_LIMITS) expect(prompt(key)).not.toBe('')
  })

  it.each<[LimitKey, string]>([
    ['pieces_created_max', 'Trial includes 3 pieces, and you have made all 3. Deleting a piece does not give one back.'],
    ['new_pieces_paused', 'New pieces are paused for Trial for now. Try again later.'],
    ['new_pieces_per_day', "Trial has used today's new pieces. Try again tomorrow."],
    ['parts_per_piece_max', 'Trial pieces have one part. To practice another part, make it a new piece.'],
    ['split_pdf', 'Trial pieces have one part, so one PDF with several parts is not included. Choose a PDF that holds one part.'],
    ['advanced_reading', 'Advanced Reading is not included in Trial. The part is read the standard way.'],
    ['pages_per_part_max', 'Trial reads PDFs of up to 20 pages. Choose a shorter PDF.'],
    ['recording_minutes_max', 'Trial takes recordings of up to 10 minutes. Choose a shorter recording.'],
    ['read_again_per_part_max', 'Trial lets you reprocess each part twice, and this part has used both.'],
    ['realign_per_piece_max', 'Trial lets you realign each piece 5 times, and this piece has used all 5.'],
    ['pieces_stored_max', 'Trial keeps up to 3 pieces at once. Delete one to make room.'],
    ['shared_pieces_max', 'Trial includes 1 shared piece. Turn sharing off on another piece to share this one.'],
    ['suggest_name', 'Suggest a name is not in your plan.'],
  ])('%s', (limit, sentence) => {
    expect(prompt(limit)).toBe(sentence)
  })

  it('says the monthly Advanced Reading count, and handles one and none', () => {
    const creator = { ...trial, id: 'creator', name: 'Creator', advanced_reading_parts_per_month: 30 } satisfies PlanRow
    expect(prompt('advanced_reading_parts_per_month', creator)).toBe("You have used this month's 30 Advanced Reading parts.")
    expect(prompt('pieces_created_max', { ...trial, pieces_created_max: 1 })).toContain('includes 1 piece, and you have made it.')
    expect(prompt('read_again_per_part_max', { ...trial, read_again_per_part_max: 1 })).toContain('reprocess each part once, and this part has used it.')
    expect(prompt('realign_per_piece_max', { ...trial, realign_per_piece_max: 0 })).toBe('Trial does not include realigning a piece.')
    expect(prompt('parts_per_piece_max', { ...trial, name: 'Creator', parts_per_piece_max: 4 })).toBe('Creator pieces have up to 4 parts.')
    expect(prompt('split_pdf', { ...trial, name: 'Creator', parts_per_piece_max: null })).toBe('Splitting a PDF with several parts is not included in Creator.')
    expect(prompt('recording_minutes_max', { ...trial, recording_minutes_max: 1 })).toContain('up to 1 minute.')
  })

  it('titles: New pieces are paused for the two plan-wide limits, Not in your <plan> plan for the rest', () => {
    expect(strings.plans.promptTitle('new_pieces_paused', 'Trial')).toBe('New pieces are paused')
    expect(strings.plans.promptTitle('new_pieces_per_day', 'Trial')).toBe('New pieces are paused')
    expect(strings.plans.promptTitle('pieces_created_max', 'Trial')).toBe('Not in your Trial plan')
    expect(strings.plans.promptTitle('advanced_reading', 'Creator')).toBe('Not in your Creator plan')
  })

  it('the Your plan dialog\'s values read as the prototype\'s', () => {
    const { values } = strings.plans.yourPlan
    expect(values.made(2, 3)).toBe('2 of 3 made')
    expect(values.partsPerPiece(1)).toBe('1 part per piece')
    expect(values.sharedOf(1, 1)).toBe('1 of 1')
    expect(values.notIncluded).toBe('Not included')
    expect(values.perPart(2)).toBe('2 per part')
    expect(values.upToMinutes(10)).toBe('Up to 10 minutes')
    expect(values.upToPages(20)).toBe('Up to 20 pages')
    expect(strings.plans.yourPlan.noLimit).toBe('No limit')
    expect(strings.plans.yourPlan.noLimits).toBe('No limits')
    expect(strings.plans.yourPlan.title('Trial')).toBe('Your plan: Trial')
    expect(strings.plans.usedLine(2, 3, 'Trial')).toBe('2 of 3 trial pieces used.')
    expect(strings.plans.badge).toEqual({ trial: 'TRIAL', creator: 'CREATOR', unlimited: 'UNLIMITED', admin: 'ADMIN' })
    expect(strings.plans.badgeScreenReader('Trial')).toBe('Your plan: Trial')
  })
})
