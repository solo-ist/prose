import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { hostname, tmpdir } from 'os'
import { join } from 'path'
import {
  PENDING_FILE,
  PENDING_TTL_MS,
  RESULT_FILE,
  appStoreAvailable,
  appStoreSource,
  declineImport,
  filesInsideContainer,
  importStagedKeys,
  importStatus,
  isProfileFresh,
  readResult,
  requestImport,
  runPendingImport,
  transformSettings,
  type AppStoreSource
} from './appStoreImport'

const NOW = Date.parse('2026-11-07T12:00:00Z')
let root: string
let userData: string
let container: string
let source: AppStoreSource

function write(path: string, content = 'x'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

const appStoreSettings = {
  aiConsent: { consented: true, version: 1 },
  lastSeenVersion: '1.6.5',
  llm: { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'leaked-should-not-travel' },
  masDirectoryBookmark: 'Ym9va21hcms=',
  projects: [{ id: 'p1', name: 'Notes', path: '/Users/u/Notes', bookmark: 'YmtfcDE=', createdAt: '2026-01-01' }],
  favorites: [{ id: 'f1', name: 'Inbox', path: '/Users/u/Inbox', bookmark: 'YmtfZjE=', addedAt: '2026-01-01' }],
  recentFiles: ['/Users/u/Notes/a.md']
}

/** A fake App Store profile with every kind of item, kept and excluded. */
function seedAppStoreProfile(dataDir: string): void {
  write(join(dataDir, 'settings.json'), JSON.stringify(appStoreSettings))
  write(join(dataDir, 'IndexedDB', 'file__0.indexeddb.leveldb', 'CURRENT'), 'MANIFEST-000001')
  write(join(dataDir, 'Local Storage', 'leveldb', 'CURRENT'), 'MANIFEST-000002')
  write(join(dataDir, 'dictionary.json'), '["prose"]')
  write(join(dataDir, 'migration-v2.done'), '')
  write(join(dataDir, 'credentials', 'llm-api-key'), 'encrypted-llm')
  write(join(dataDir, 'credentials', 'remarkable-device-token'), 'encrypted-rm')
  write(join(dataDir, 'mcp-auth-token'), 'secret')
  write(join(dataDir, 'prose.sock'), '')
  write(join(dataDir, 'share-sync.json'), '{}')
  write(join(dataDir, 'Cache', 'data_0'), 'cache')
  write(join(dataDir, 'mcp-server', 'mcp-stdio.cjs'), 'bridge')
  write(join(dataDir, 'Preferences'), '{}')
  // A stale lock from a crashed session: not copied, and does not block.
  symlinkSync(`${hostname()}-999999`, join(dataDir, 'SingletonLock'))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prose-1243-'))
  userData = join(root, 'direct')
  container = join(root, 'Containers', 'ist.solo.prose')
  source = { containerDir: container, dataDir: join(container, 'Data', 'Library', 'Application Support', 'Prose') }
  mkdirSync(userData, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('transformSettings', () => {
  it('drops bookmarks and secrets, and keeps everything else', () => {
    const out = transformSettings(appStoreSettings)
    expect(out.masDirectoryBookmark).toBeUndefined()
    expect((out.projects as Array<Record<string, unknown>>)[0]).toEqual({ id: 'p1', name: 'Notes', path: '/Users/u/Notes', createdAt: '2026-01-01' })
    expect((out.favorites as Array<Record<string, unknown>>)[0].bookmark).toBeUndefined()
    expect((out.llm as { apiKey: string; model: string }).apiKey).toBe('')
    expect((out.llm as { model: string }).model).toBe('claude-sonnet-5-5')
    expect(out.lastSeenVersion).toBe('1.6.5')
    expect(out.aiConsent).toEqual(appStoreSettings.aiConsent)
  })

  it('lists the paths that live inside the App Store container', () => {
    const inside = join(container, 'Data', 'Documents', 'Untitled.md')
    const settings = { recentFiles: [inside, '/Users/u/a.md'], defaultSaveDirectory: join(container, 'Data', 'Documents') }
    expect(filesInsideContainer(settings, container)).toEqual([inside, join(container, 'Data', 'Documents')])
    expect(filesInsideContainer(settings, null)).toEqual([])
  })
})

describe('runPendingImport', () => {
  it('does nothing without a pending request', () => {
    seedAppStoreProfile(source.dataDir)
    expect(runPendingImport(userData, source, { now: NOW, log: () => {} })).toBeNull()
    expect(readdirSync(userData)).toEqual([])
  })

  it('ignores and removes an expired request', () => {
    seedAppStoreProfile(source.dataDir)
    requestImport(userData, NOW - PENDING_TTL_MS - 1)
    expect(runPendingImport(userData, source, { now: NOW, log: () => {} })).toBeNull()
    expect(existsSync(join(userData, PENDING_FILE))).toBe(false)
    expect(existsSync(join(userData, 'settings.json'))).toBe(false)
  })

  it('copies the allowlist, stages the key, backs up what it replaces and leaves the source alone', () => {
    seedAppStoreProfile(source.dataDir)
    write(join(userData, 'settings.json'), '{"fresh":true}')
    write(join(userData, 'IndexedDB', 'old', 'CURRENT'), 'old-db')
    requestImport(userData, NOW - 1000)

    const result = runPendingImport(userData, source, { now: NOW, log: () => {} })

    expect(result?.state).toBe('imported')
    expect(result?.copied).toEqual(['settings.json', 'IndexedDB', 'Local Storage', 'dictionary.json', 'migration-v2.done'])
    expect(result?.skipped).toEqual(['Custom Dictionary.txt', 'dialog-dirs.json'])
    expect(result?.stagedCredentials).toEqual(['llm-api-key'])

    const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8'))
    expect(settings.projects[0].bookmark).toBeUndefined()
    expect(settings.llm.apiKey).toBe('')
    expect(readFileSync(join(userData, 'IndexedDB', 'file__0.indexeddb.leveldb', 'CURRENT'), 'utf-8')).toBe('MANIFEST-000001')
    expect(readFileSync(join(userData, 'dictionary.json'), 'utf-8')).toBe('["prose"]')

    // Never copied.
    for (const name of ['mcp-auth-token', 'prose.sock', 'SingletonLock', 'share-sync.json', 'Cache', 'mcp-server', 'Preferences', 'credentials']) {
      expect(existsSync(join(userData, name)), name).toBe(false)
    }
    // The key waits for the user's say-so, outside credentials/.
    expect(readdirSync(join(userData, 'app-store-import', 'credentials'))).toEqual(['llm-api-key'])

    // What was replaced is in the backup.
    expect(result?.backupDir).toBeDefined()
    expect(readFileSync(join(result!.backupDir!, 'settings.json'), 'utf-8')).toBe('{"fresh":true}')
    expect(readFileSync(join(result!.backupDir!, 'IndexedDB', 'old', 'CURRENT'), 'utf-8')).toBe('old-db')

    expect(existsSync(join(userData, PENDING_FILE))).toBe(false)
    expect(readdirSync(userData).some((name) => name.startsWith('.app-store-import-staging'))).toBe(false)
    expect(readResult(userData)?.state).toBe('imported')

    // Copy, never move.
    for (const name of ['settings.json', 'IndexedDB', 'credentials', 'mcp-auth-token']) {
      expect(existsSync(join(source.dataDir, name)), name).toBe(true)
    }
  })

  it('refuses while the App Store edition is running and copies nothing', () => {
    seedAppStoreProfile(source.dataDir)
    rmSync(join(source.dataDir, 'SingletonLock'))
    symlinkSync(`${hostname()}-${process.pid}`, join(source.dataDir, 'SingletonLock'))
    requestImport(userData, NOW)
    const result = runPendingImport(userData, source, { now: NOW, log: () => {} })
    expect(result).toMatchObject({ state: 'failed', error: 'running' })
    expect(existsSync(join(userData, 'settings.json'))).toBe(false)
  })

  it('changes nothing when a copy fails', () => {
    seedAppStoreProfile(source.dataDir)
    write(join(source.dataDir, 'settings.json'), '{ not json')
    write(join(userData, 'settings.json'), '{"fresh":true}')
    requestImport(userData, NOW)
    const result = runPendingImport(userData, source, { now: NOW, log: () => {} })
    expect(result).toMatchObject({ state: 'failed', error: 'copy-failed' })
    expect(readFileSync(join(userData, 'settings.json'), 'utf-8')).toBe('{"fresh":true}')
    expect(existsSync(join(userData, 'IndexedDB'))).toBe(false)
    expect(readdirSync(userData).filter((name) => name.startsWith('.app-store-import') || name.startsWith('before-'))).toEqual([])
  })

  it('reports an App Store profile with nothing to import', () => {
    mkdirSync(source.dataDir, { recursive: true })
    requestImport(userData, NOW)
    expect(runPendingImport(userData, source, { now: NOW, log: () => {} }))
      .toMatchObject({ state: 'failed', error: 'nothing-to-import' })
    requestImport(userData, NOW)
    expect(runPendingImport(userData, null, { now: NOW, log: () => {} }))
      .toMatchObject({ state: 'failed', error: 'nothing-to-import' })
  })
})

describe('status and offer', () => {
  it('finds the App Store edition only where it should look', () => {
    expect(appStoreSource({}, '/Users/u')).toEqual({
      containerDir: '/Users/u/Library/Containers/ist.solo.prose',
      dataDir: '/Users/u/Library/Containers/ist.solo.prose/Data/Library/Application Support/Prose'
    })
    // Test runs never see a real container.
    expect(appStoreSource({ PROSE_USER_DATA_DIR: '/tmp/p' }, '/Users/u')).toBeNull()
    expect(appStoreSource({ PROSE_USER_DATA_DIR: '/tmp/p', PROSE_APP_STORE_DATA_DIR: '/tmp/s' }, '/Users/u'))
      .toEqual({ containerDir: null, dataDir: '/tmp/s' })
  })

  it('checks only the container entry, and only in a packaged app', () => {
    mkdirSync(container, { recursive: true })
    expect(appStoreAvailable(source, true)).toBe(true)
    expect(appStoreAvailable(source, false)).toBe(false)
    expect(appStoreAvailable(null, true)).toBe(false)
    expect(appStoreAvailable({ containerDir: null, dataDir: join(root, 'missing') }, false)).toBe(false)
  })

  it('offers on a fresh profile once, and never after a decision', () => {
    mkdirSync(container, { recursive: true })
    expect(isProfileFresh(userData)).toBe(true)
    expect(importStatus(userData, source, true).offer).toBe(true)

    write(join(userData, 'settings.json'), '{"theme":"dark"}')
    expect(importStatus(userData, source, true).offer).toBe(true)

    declineImport(userData, NOW)
    expect(importStatus(userData, source, true)).toMatchObject({ available: true, offer: false, result: { state: 'declined' } })

    rmSync(join(userData, RESULT_FILE))
    write(join(userData, 'settings.json'), JSON.stringify({ aiConsent: { consented: true, version: 1 } }))
    expect(importStatus(userData, source, true).offer).toBe(false)
    write(join(userData, 'settings.json'), '{ broken')
    expect(isProfileFresh(userData)).toBe(false)
  })
})

describe('importStagedKeys', () => {
  function stage(value = 'encrypted'): void {
    write(join(userData, 'app-store-import', 'credentials', 'llm-api-key'), value)
    write(join(userData, RESULT_FILE), JSON.stringify({ state: 'imported', at: 'x', stagedCredentials: ['llm-api-key'] }))
  }

  it('stores a key that decrypts cleanly and removes the staged copy', async () => {
    stage()
    const store = vi.fn(async () => {})
    const result = await importStagedKeys(userData, { decrypt: () => 'sk-ant-api03-abcdef', hasKey: async () => false, store })
    expect(result).toEqual({ imported: ['llm-api-key'], failed: [], skipped: [] })
    expect(store).toHaveBeenCalledWith('llm-api-key', 'sk-ant-api03-abcdef')
    expect(existsSync(join(userData, 'app-store-import'))).toBe(false)
    expect(readResult(userData)?.stagedCredentials).toEqual([])
  })

  it('reports a key it cannot read, and stores nothing', async () => {
    for (const decrypt of [() => { throw new Error('Error while decrypting') }, () => '\u0001\u0002garbage\u0000']) {
      stage()
      const store = vi.fn(async () => {})
      const result = await importStagedKeys(userData, { decrypt, hasKey: async () => false, store })
      expect(result.failed).toEqual(['llm-api-key'])
      expect(store).not.toHaveBeenCalled()
      expect(existsSync(join(userData, 'app-store-import'))).toBe(false)
    }
  })

  it('keeps a key this copy already has', async () => {
    stage()
    const store = vi.fn(async () => {})
    const decrypt = vi.fn(() => 'sk-ant-api03-abcdef')
    const result = await importStagedKeys(userData, { decrypt, hasKey: async () => true, store })
    expect(result.skipped).toEqual(['llm-api-key'])
    expect(decrypt).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
  })
})
