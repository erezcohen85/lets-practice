import { partReviewState } from '@/domain/partStatus'

describe('partReviewState', () => {
  it('is not-reviewed while nothing is checked', () => {
    expect(partReviewState({ checked: 0, total: 4 })).toBe('not-reviewed')
  })

  it('is not-reviewed for a part that has no bars to check yet', () => {
    expect(partReviewState({ checked: 0, total: 0 })).toBe('not-reviewed')
  })

  it('is partly-reviewed once some but not all are checked', () => {
    expect(partReviewState({ checked: 1, total: 4 })).toBe('partly-reviewed')
    expect(partReviewState({ checked: 3, total: 4 })).toBe('partly-reviewed')
  })

  it('is all-checked when every one is checked', () => {
    expect(partReviewState({ checked: 4, total: 4 })).toBe('all-checked')
  })

  it('treats more checked than total as all checked', () => {
    expect(partReviewState({ checked: 5, total: 4 })).toBe('all-checked')
  })
})
