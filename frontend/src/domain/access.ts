/** Who someone is to a piece, and what that lets them do (Login and Sharing Spec, section 2). Every UI gate calls these. */
export type Role = 'owner' | 'viewer'
export type PieceAction = 'practise' | 'edit' | 'share' | 'leave' | 'review'

const ALLOWED: Record<PieceAction, readonly Role[]> = {
  practise: ['owner', 'viewer'],
  edit: ['owner'],
  review: ['owner'],
  share: ['owner'],
  leave: ['viewer'],
}

export function roleOf(piece: { ownerId: string }, userId: string): Role {
  return piece.ownerId === userId ? 'owner' : 'viewer'
}

export function can(role: Role, action: PieceAction): boolean {
  return ALLOWED[action].includes(role)
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** The email as the plan assignments keep it (trimmed, lower case), or null when the text is not an email. */
export function normalizeEmail(text: string): string | null {
  const email = text.trim().toLowerCase()
  return EMAIL.test(email) ? email : null
}
