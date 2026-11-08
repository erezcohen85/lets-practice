import { fireEvent, render, screen } from '@testing-library/react'
import { strings } from '@/strings'
import { AudioPicker } from './AudioPicker'

const mp3 = new File(['x'], 'take 1.mp3', { type: 'audio/mpeg' })

describe('AudioPicker', () => {
  it('is a drop area, like the PDF one, that says where to drop the file', () => {
    render(<AudioPicker file={null} onChange={() => {}} invalid={false} />)
    expect(screen.getByText(strings.newPiece.audioDropZone)).toBeInTheDocument()
    expect(screen.getByLabelText(strings.newPiece.audioChoose)).toHaveAttribute('accept', 'audio/*')
  })

  it('takes an audio file dropped on it', () => {
    const onChange = vi.fn()
    render(<AudioPicker file={null} onChange={onChange} invalid={false} />)
    const area = screen.getByText(strings.newPiece.audioDropZone).closest('label')!

    fireEvent.drop(area, { dataTransfer: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' }), mp3] } })

    expect(onChange).toHaveBeenCalledWith(mp3)
  })

  it('ignores a drop with no audio file in it', () => {
    const onChange = vi.fn()
    render(<AudioPicker file={null} onChange={onChange} invalid={false} />)
    const area = screen.getByText(strings.newPiece.audioDropZone).closest('label')!

    fireEvent.drop(area, { dataTransfer: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the chosen file by name', () => {
    render(<AudioPicker file={mp3} onChange={() => {}} invalid={false} />)
    expect(screen.getByText('take 1.mp3')).toBeInTheDocument()
  })
})
