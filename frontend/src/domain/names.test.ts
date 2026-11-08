import { describe, expect, it } from 'vitest'
import { checkName, MAX_PART_NAME, MAX_RECORDING_NAME, recordingNameFromFile, requireName } from './names'

describe('checkName', () => {
  it('trims the name', () => {
    expect(checkName('  Clarinet 1  ', MAX_PART_NAME)).toEqual({ name: 'Clarinet 1' })
  })

  it('refuses an empty name and one of only spaces', () => {
    expect(checkName('', MAX_PART_NAME)).toEqual({ problem: 'empty' })
    expect(checkName('   ', MAX_PART_NAME)).toEqual({ problem: 'empty' })
  })

  it('allows exactly the longest name and refuses one more character', () => {
    expect(checkName('p'.repeat(80), MAX_PART_NAME)).toEqual({ name: 'p'.repeat(80) })
    expect(checkName('p'.repeat(81), MAX_PART_NAME)).toEqual({ problem: 'too-long' })
    expect(checkName('r'.repeat(120), MAX_RECORDING_NAME)).toEqual({ name: 'r'.repeat(120) })
    expect(checkName('r'.repeat(121), MAX_RECORDING_NAME)).toEqual({ problem: 'too-long' })
  })

  it('counts the length of the trimmed name', () => {
    expect(checkName(` ${'p'.repeat(80)} `, MAX_PART_NAME)).toEqual({ name: 'p'.repeat(80) })
  })
})

describe('recordingNameFromFile', () => {
  it('drops the extension and nothing else', () => {
    expect(recordingNameFromFile('Los Banditos band performance march 2019.mp3')).toBe('Los Banditos band performance march 2019')
    expect(recordingNameFromFile('take_3-final.v2.M4A')).toBe('take_3-final.v2')
  })

  it('keeps a name that has no extension, and one that is only an extension', () => {
    expect(recordingNameFromFile('take 3')).toBe('take 3')
    expect(recordingNameFromFile('.mp3')).toBe('.mp3')
  })

  it('is cut to the longest recording name', () => {
    expect(recordingNameFromFile(`${'r'.repeat(200)}.mp3`)).toHaveLength(MAX_RECORDING_NAME)
  })
})

describe('requireName', () => {
  it('gives the trimmed name', () => {
    expect(requireName(' Flute ', MAX_PART_NAME)).toBe('Flute')
  })

  it('throws a sentence that says why', () => {
    expect(() => requireName(' ', MAX_PART_NAME)).toThrow('name is empty')
    expect(() => requireName('p'.repeat(81), MAX_PART_NAME)).toThrow('name is too long')
  })
})
