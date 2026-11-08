import { describe, expect, it } from 'vitest'
import type { Person } from './adminDraft'
import { csvFileName, peopleCsv } from './peopleCsv'

const person = (over: Partial<Person> & { email: string }): Person => ({
  display_name: null,
  signed_up: true,
  last_sign_in_at: '2026-11-06T12:00:00Z',
  plan_id: 'trial',
  assigned: false,
  assigned_plan_id: null,
  is_admin: false,
  added_at: null,
  pieces_created: 0,
  pieces_stored: 0,
  shared_pieces: 0,
  ...over,
})

const NAMES = { trial: 'Trial', creator: 'Creator', unlimited: 'Unlimited' }
const HEADER = 'Email,Name,Plan,Status,Last sign-in,Pieces created,Pieces stored,Shared pieces,Added on'
/** The text after the byte-order mark, split into its lines. */
const lines = (csv: string) => csv.slice(1).split('\r\n')

describe('peopleCsv', () => {
  it('starts with a UTF-8 byte-order mark, then the header', () => {
    const csv = peopleCsv([], NAMES)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(lines(csv)[0]).toBe(HEADER)
  })

  it('with nobody gives the header alone, ending in CRLF', () => {
    expect(peopleCsv([], NAMES)).toBe('﻿' + HEADER + '\r\n')
  })

  it('writes one line per person, with the plan name, the status and the counts', () => {
    const csv = peopleCsv(
      [
        person({ email: 'maya@example.com', display_name: 'Maya', pieces_created: 3, pieces_stored: 2, shared_pieces: 1 }),
        person({ email: 'noam@example.com', plan_id: 'creator', assigned: true, added_at: '2026-10-20T08:00:00Z' }),
      ],
      NAMES,
    )
    expect(lines(csv)).toEqual([
      HEADER,
      'maya@example.com,Maya,Trial,Signed in,2026-11-06,3,2,1,',
      'noam@example.com,,Creator,Signed in,2026-11-06,0,0,0,2026-10-20',
      '',
    ])
  })

  it('leaves the sign-in empty for someone who never signed in, and says so in Status', () => {
    const csv = peopleCsv([person({ email: 'later@example.com', signed_up: false, last_sign_in_at: null, plan_id: 'creator', added_at: '2026-11-02T08:00:00Z' })], NAMES)
    expect(lines(csv)[1]).toBe('later@example.com,,Creator,Not signed in yet,,0,0,0,2026-11-02')
  })

  it('falls back to the plan id when the plan has no name in the map', () => {
    expect(lines(peopleCsv([person({ email: 'a@x.com' })], {}))[1]).toBe('a@x.com,,trial,Signed in,2026-11-06,0,0,0,')
  })

  it('quotes a cell with a comma, a quote or a line break, doubling the quotes (RFC 4180)', () => {
    const csv = peopleCsv([person({ email: 'a@x.com', display_name: 'Levi, Maya' }), person({ email: 'b@x.com', display_name: 'Maya "Mimi" Levi' }), person({ email: 'c@x.com', display_name: 'Two\nlines' })], NAMES)
    const rows = csv.slice(1)
    expect(rows).toContain('a@x.com,"Levi, Maya",Trial')
    expect(rows).toContain('b@x.com,"Maya ""Mimi"" Levi",Trial')
    expect(rows).toContain('c@x.com,"Two\nlines",Trial')
  })

  it('keeps a Hebrew name as it is', () => {
    expect(lines(peopleCsv([person({ email: 'a@x.com', display_name: 'מאיה לוי' })], NAMES))[1]).toBe('a@x.com,מאיה לוי,Trial,Signed in,2026-11-06,0,0,0,')
  })

  it('puts a quote before a cell that starts with = + - @ tab or carriage return, so a spreadsheet does not run it', () => {
    for (const bad of ['=SUM(A1:A9)', '+1', '-2', '@cmd', '\tx', '\rx']) {
      const row = peopleCsv([person({ email: 'a@x.com', display_name: bad })], NAMES).slice(1).split('\r\n')[1]!
      expect(row.startsWith(`a@x.com,${bad.includes('\r') ? '"' : ''}'${bad}`)).toBe(true)
    }
  })

  it('guards the email cell too, and a guarded cell with a comma is still quoted', () => {
    const csv = peopleCsv([person({ email: '=evil@x.com' }), person({ email: 'b@x.com', display_name: '=A1,B1' })], NAMES)
    expect(lines(csv)[1]!.startsWith("'=evil@x.com,")).toBe(true)
    expect(lines(csv)[2]).toContain(`"'=A1,B1"`)
  })

  it('leaves a name with the characters in the middle alone', () => {
    expect(lines(peopleCsv([person({ email: 'a@x.com', display_name: 'a=b+c-d@e' })], NAMES))[1]).toContain(',a=b+c-d@e,')
  })

  it('writes the sign-in and added dates as the UTC calendar date of the stored time', () => {
    const csv = peopleCsv([person({ email: 'a@x.com', last_sign_in_at: '2026-11-06T23:59:59Z', added_at: '2026-01-02T00:00:00+00:00' })], NAMES)
    expect(lines(csv)[1]).toBe('a@x.com,,Trial,Signed in,2026-11-06,0,0,0,2026-01-02')
  })
})

describe('csvFileName', () => {
  it('is lets-practice-people-YYYY-MM-DD.csv for the day of now, padded', () => {
    expect(csvFileName(new Date(2026, 10, 8, 15))).toBe('lets-practice-people-2026-11-08.csv')
    expect(csvFileName(new Date(2026, 0, 2, 0, 5))).toBe('lets-practice-people-2026-01-02.csv')
    expect(csvFileName(new Date(2026, 11, 31, 23, 59))).toBe('lets-practice-people-2026-12-31.csv')
  })
})
