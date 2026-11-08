// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Docker and Caddy are not on this Mac, so this checks the files as text. The real check is curl against the deployed
// service, in Checkpoint M1.
const read = (name: string) => readFileSync(resolve(__dirname, '../..', name), 'utf8')

describe('the frontend image', () => {
  it('takes each VITE_ variable as a build argument, and refuses to build without it', () => {
    const file = read('Dockerfile')
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_PROCESSOR_URL']) {
      expect(file).toContain(`ARG ${name}`)
      expect(file).toContain(`test -n "$${name}"`)
    }
  })

  it('names the missing variable when it refuses to build', () => {
    const file = read('Dockerfile')
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_PROCESSOR_URL']) {
      expect(file).toMatch(new RegExp(`test -n "\\$${name}" \\|\\| \\{ echo "[^"]*${name}[^"]*"`))
    }
  })

  it('never takes a secret or the fakes', () => {
    const file = read('Dockerfile')
    expect(file).not.toMatch(/SECRET|SERVICE_ROLE|VITE_USE_FAKES|VITE_LOCAL_RUN/)
  })

  it('leaves env files out of the build', () => {
    expect(read('.dockerignore')).toMatch(/^\.env\*$/m)
  })
})

describe('the Caddyfile', () => {
  const file = read('Caddyfile')

  it('listens on the port Railway gives', () => {
    expect(file).toContain(':{$PORT:8080}')
  })

  // The text of the block that opens at `opening`, up to its matching closing brace.
  const block = (opening: string) => {
    const start = file.indexOf(opening)
    expect(start, `${opening} is in the Caddyfile`).toBeGreaterThanOrEqual(0)
    let depth = 0
    for (let i = file.indexOf('{', start); i < file.length; i++) {
      if (file[i] === '{') depth++
      if (file[i] === '}' && --depth === 0) return file.slice(start, i + 1)
    }
    throw new Error(`${opening} is not closed`)
  }
  const assets = block('handle /assets/*')
  const fallback = block('\thandle {')

  it('answers any address with the app, so /join/<token> is no 404', () => {
    expect(fallback).toContain('try_files {path} /index.html')
  })

  it('does not answer a missing asset with the app', () => {
    expect(assets).not.toMatch(/try_files|index\.html/)
    expect(file.match(/try_files/g)).toHaveLength(1)
  })

  it('marks only a file that exists as cacheable for a year, never a missing one', () => {
    expect(file).toMatch(/^\t@found file$/m)
    expect(assets).toContain('header @found Cache-Control "public, max-age=31536000, immutable"')
    expect(file.match(/immutable/g)).toHaveLength(1)
  })

  it('sends a www address to the bare domain, keeping the path and query, before any handle', () => {
    expect(file).toMatch(/^\t@www header_regexp www Host \^www\\\.\(\.\+\)\$$/m)
    expect(file).toMatch(/^\tredir @www https:\/\/\{re\.www\.1\}\{uri\} permanent$/m)
    expect(file.indexOf('redir @www')).toBeLessThan(file.indexOf('handle /assets/*'))
  })

  it('names no domain, so the same file serves Prod, dev and any copy', () => {
    expect(file).not.toMatch(/letspractice|railway\.app/)
  })

  it('sets the referrer policy explicitly, outside every handle so a 404 carries it too (M-3)', () => {
    const at = file.indexOf('Referrer-Policy "strict-origin-when-cross-origin"')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(file.indexOf('handle /assets/*'))
  })
})
