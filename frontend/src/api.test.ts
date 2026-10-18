import { describe, expect, it } from 'vitest'
import { normalizeSearch } from './api'
describe('normalizeSearch', () => {
  it('keeps enhanced metadata and ignores malformed API rows', () => { expect(normalizeSearch({ results: [{ path: 'src/app.ts', line: 12, text: 'fetch()', kind: 'symbol', language: 'TypeScript' }, { path: 'README.md', line: 'bad' }, null] })).toEqual([{ path: 'src/app.ts', line: 12, text: 'fetch()', kind: 'symbol', language: 'TypeScript' }]) })
  it('supplies safe defaults for older result rows', () => { expect(normalizeSearch({ results: [{ path: 'README.md', line: 3, text: 'hello' }] })).toEqual([{ path: 'README.md', line: 3, text: 'hello', kind: 'content', language: null }]) })
  it('normalizes missing payloads to an empty result set', () => { expect(normalizeSearch(undefined)).toEqual([]); expect(normalizeSearch({})).toEqual([]) })
})
