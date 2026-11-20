// @vitest-environment node
/** The store-only zip writer (#1257), checked by the system's own unzip. */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createZip } from './zip'

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

function written(zip: Buffer): string {
  dir = mkdtempSync(join(tmpdir(), 'prose-zip-'))
  const file = join(dir, 'test.zip')
  writeFileSync(file, zip)
  return file
}

describe('createZip', () => {
  const binary = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256))
  const entries = [
    { name: 'manifest.json', data: '{"name":"prose"}\n' },
    { name: 'server/index.cjs', data: binary, mode: 0o755 },
    { name: 'notes/ünïcödé.txt', data: 'é\n' }
  ]

  it('round-trips through unzip: names, sizes, CRCs and bytes', () => {
    const file = written(createZip(entries))
    const listing = execFileSync('unzip', ['-l', file], { encoding: 'utf8' })
    expect(listing).toMatch(/17\s+\S+\s+\S+\s+manifest\.json/)
    expect(listing).toMatch(/4096\s+\S+\s+\S+\s+server\/index\.cjs/)
    expect(listing).toContain('notes/ünïcödé.txt')
    expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toContain('No errors detected')
    expect(execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' })).toBe('{"name":"prose"}\n')
    expect(Buffer.compare(execFileSync('unzip', ['-p', file, 'server/index.cjs']), binary)).toBe(0)
  })

  it('records Unix modes and a fixed date, so the same input gives the same bytes', () => {
    const zip = createZip(entries)
    expect(Buffer.compare(zip, createZip(entries))).toBe(0)
    const verbose = execFileSync('unzip', ['-Z', written(zip)], { encoding: 'utf8' })
    expect(verbose).toMatch(/-rwxr-xr-x .* server\/index\.cjs/)
    expect(verbose).toMatch(/-rw-r--r-- .* manifest\.json/)
    expect(verbose).toMatch(/80-Jan-01|1980/)
  })

  it('an empty archive is just the end-of-central-directory record', () => {
    const empty = createZip([])
    expect(empty.length).toBe(22)
    expect(empty.readUInt32LE(0)).toBe(0x06054b50)
  })
})
