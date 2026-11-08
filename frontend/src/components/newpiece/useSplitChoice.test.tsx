import { act, renderHook } from '@testing-library/react'
import { type SplitProposal } from '@/domain/splitEdits'
import { useSplitChoice } from '@/components/newpiece/useSplitChoice'

const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' })
const proposal = (name: string): SplitProposal => ({ splitId: name, pageCount: 1, fullScore: false, parts: [{ name, fromPage: 1, toPage: 1 }], pages: [], note: null })

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

describe('useSplitChoice', () => {
  it('takes only the answer for the PDF chosen last, however late an older one comes', async () => {
    const first = deferred<SplitProposal>()
    const second = deferred<SplitProposal>()
    const answers = [first.promise, second.promise]
    const { result } = renderHook(() => useSplitChoice(() => answers.shift()!))

    let reading: Promise<void>[] = []
    await act(async () => {
      reading = [result.current.choose([pdf('first.pdf')]), result.current.choose([pdf('second.pdf')])]
    })
    await act(async () => {
      second.resolve(proposal('Second'))
      await reading[1]
    })
    await act(async () => {
      first.resolve(proposal('First'))
      await reading[0]
    })

    expect(result.current.file?.name).toBe('second.pdf')
    expect(result.current.parts.map((part) => part.name)).toEqual(['Second'])
    expect(result.current.stage).toBe('review')
  })

  it('drops a failure of an older read too', async () => {
    const first = deferred<SplitProposal>()
    const answers = [first.promise, Promise.resolve(proposal('Second'))]
    const { result } = renderHook(() => useSplitChoice(() => answers.shift()!))

    let reading: Promise<void>[] = []
    await act(async () => {
      reading = [result.current.choose([pdf('first.pdf')]), result.current.choose([pdf('second.pdf')])]
    })
    await act(async () => {
      first.promise.catch(() => {})
      await reading[1]
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.stage).toBe('review')
  })
})
