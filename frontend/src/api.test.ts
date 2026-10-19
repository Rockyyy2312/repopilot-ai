import { describe, expect, it } from 'vitest'
import { normalizeImport, normalizeInvestigation, normalizeSearch } from './api'

describe('normalizeImport', () => {
  it('requires an id, repository name, and analyzed files', () => {
    expect(normalizeImport({ id: 'p1', repository_name: 'repo', analysis: { files: [] } }).file_count).toBe(0)
    expect(() => normalizeImport({ id: 'p1', repository_name: 'repo' })).toThrow('usable analysis result')
  })

  it('normalizes optional import fields without fabricating a success payload', () => {
    expect(normalizeImport({ id: 'p1', repository_name: 'repo', analysis: { files: [{ path: 'main.py' }] } })).toMatchObject({
      id: 'p1', repository_name: 'repo', file_count: 1, symbol_count: 0, import_count: 0, warnings: [],
    })
  })
})

describe('normalizeSearch', () => {
  it('keeps enhanced metadata and ignores malformed API rows', () => { expect(normalizeSearch({ results: [{ path: 'src/app.ts', line: 12, text: 'fetch()', kind: 'symbol', language: 'TypeScript' }, { path: 'README.md', line: 'bad' }, null] })).toEqual([{ path: 'src/app.ts', line: 12, text: 'fetch()', kind: 'symbol', language: 'TypeScript' }]) })
  it('supplies safe defaults for older result rows', () => { expect(normalizeSearch({ results: [{ path: 'README.md', line: 3, text: 'hello' }] })).toEqual([{ path: 'README.md', line: 3, text: 'hello', kind: 'content', language: null }]) })
  it('normalizes missing payloads to an empty result set', () => { expect(normalizeSearch(undefined)).toEqual([]); expect(normalizeSearch({})).toEqual([]) })
})

describe('normalizeInvestigation', () => {
  it('normalizes the structured report and safely drops malformed entries', () => {
    expect(normalizeInvestigation({ summary: 'A finding', confirmed_evidence: [{ path: 'src/app.ts', line: 8, text: 'match', kind: 'symbol' }, null], relevant_files: [{ path: 'src/app.ts', symbols: [{ name: 'boot', kind: 'function', line: 8 }] }], hypotheses: [{ text: 'Startup path is involved', confidence: 'high', evidence: ['symbol match'] }], recommended_next_steps: ['Inspect caller'], limitations: ['Static analysis only'] })).toEqual({ question: '', summary: 'A finding', confirmedEvidence: [{ path: 'src/app.ts', line: 8, text: 'match', kind: 'symbol' }], relevantFiles: [{ path: 'src/app.ts', reason: '', symbols: [{ name: 'boot', kind: 'function', path: 'src/app.ts', line: 8 }] }], hypotheses: [{ text: 'Startup path is involved', confidence: 'high', evidence: ['symbol match'] }], recommendedNextSteps: ['Inspect caller'], limitations: ['Static analysis only'] })
  })
})
