import '@testing-library/jest-dom/vitest'

// Tests must never touch the network: every fetch rejects.
globalThis.fetch = () =>
  Promise.reject(new Error('network access is blocked in tests'))
