describe('test environment', () => {
  it('blocks network access', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow(
      'network access is blocked',
    )
  })
})
