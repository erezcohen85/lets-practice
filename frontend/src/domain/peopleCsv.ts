/**
 * The People export (Erez, 2026-11-08; plans and usage limits): the rows the admin sees, as CSV text built in the browser.
 * RFC 4180 quoting, CRLF line ends, a UTF-8 byte-order mark so Excel reads Hebrew names, and a leading `'` on any cell that
 * starts with `=`, `+`, `-`, `@`, tab or carriage return, so a spreadsheet never runs a name as a formula.
 */
import type { Person } from './adminDraft'

const HEADER = ['Email', 'Name', 'Plan', 'Status', 'Last sign-in', 'Pieces created', 'Pieces stored', 'Shared pieces', 'Added on']
const BYTE_ORDER_MARK = '﻿'
const FORMULA_START = /^[=+\-@\t\r]/

function cell(text: string): string {
  const safe = FORMULA_START.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The calendar date (UTC) of a stored time, or empty. */
function day(at: string | null): string {
  return at === null ? '' : new Date(at).toISOString().slice(0, 10)
}

/** `planNames` maps a plan id to its name; an id with no name is written as it is. */
export function peopleCsv(people: Person[], planNames: Record<string, string>): string {
  const rows = people.map((p) => [
    p.email,
    p.display_name ?? '',
    planNames[p.plan_id] ?? p.plan_id,
    p.signed_up ? 'Signed in' : 'Not signed in yet',
    day(p.last_sign_in_at),
    String(p.pieces_created),
    String(p.pieces_stored),
    String(p.shared_pieces),
    day(p.added_at),
  ])
  return BYTE_ORDER_MARK + [HEADER, ...rows].map((row) => row.map(cell).join(',') + '\r\n').join('')
}

const two = (n: number) => String(n).padStart(2, '0')

/** `lets-practice-people-YYYY-MM-DD.csv`, the date being today in the admin's own time zone. */
export function csvFileName(now: Date): string {
  return `lets-practice-people-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.csv`
}
