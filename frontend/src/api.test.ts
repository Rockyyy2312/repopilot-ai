import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAssistant, normalizeGraph, normalizeImport, normalizeInvestigation, normalizeOverview, normalizePreferences, normalizeProjectList, normalizeSearch, normalizeJob, request } from './api'

afterEach(() => vi.restoreAllMocks())

describe('request errors', () => {
  it('turns FastAPI validation details into a useful message and preserves status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: [{ loc: ['body', 'url'], msg: 'field required' }] }), { status: 422, headers: { 'Content-Type': 'application/json' } })))
    await expect(request('/projects/import/github', { method: 'POST' })).rejects.toMatchObject({ message: 'Validation failed: body.url: field required', status: 422 })
  })

  it('turns network failures into an actionable Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(request('/projects')).rejects.toMatchObject({ message: 'Unable to reach the API. Check your connection and try again.' })
  })

  it('uses the configured Vite API base URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/configured-api/')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await request('/health')

    expect(fetch).toHaveBeenCalledWith('/configured-api/health', expect.objectContaining({ credentials: 'include' }))
  })
})

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

describe('workspace response normalizers', () => {
  it('guards overview, preferences, graph, and project-list payloads', () => {
    expect(normalizeOverview({ project_id: 'p1', total_lines: 'bad', languages: [{ name: 'TypeScript', files: 2, lines: 10 }, null], warnings: [{ path: 'a.ts', reason: 'limited' }] })).toMatchObject({ project_id: 'p1', total_lines: 0, languages: [{ name: 'TypeScript', files: 2, lines: 10 }], warnings: [{ path: 'a.ts', reason: 'limited' }] })
    expect(normalizePreferences({ display_name: 4, reduced_motion: 'yes', compact_mode: true })).toEqual({ display_name: '', reduced_motion: false, compact_mode: true })
    expect(normalizeGraph({ nodes: [{ id: 'a.ts', type: 'file' }, { id: 2 }], edges: [{ from: 'a.ts', to: 'pkg', evidence: { resolved: true } }, { from: '', to: 'bad' }] })).toEqual({ nodes: [{ id: 'a.ts', type: 'file' }], edges: [{ from: 'a.ts', to: 'pkg', evidence: { line: 0, kind: 'import', resolved: true, module: undefined } }], limitations: [] })
    expect(normalizeProjectList({ projects: [{ id: 'p1', repository_name: 'repo', analysis: { files: [] } }, { id: 'bad' }] }).projects).toHaveLength(1)
  })

  it('normalizes bounded graph and import job metadata', () => {
    expect(normalizeGraph({ nodes: [], edges: [], truncated: { nodes: true, edges: false, total_nodes: 2500, total_edges: 4, limit: 2000 } }).truncated).toMatchObject({ nodes: true, total_nodes: 2500, limit: 2000 })
    expect(normalizeJob({ id: 'job-1', status: 'running', progress: 1.5, message: 'Indexing', created_at: 1, updated_at: 2 })).toMatchObject({ id: 'job-1', status: 'running', progress: 1, message: 'Indexing' })
  })
})

describe('normalizeInvestigation', () => {
  it('normalizes the structured report and safely drops malformed entries', () => {
    expect(normalizeInvestigation({ summary: 'A finding', confirmed_evidence: [{ path: 'src/app.ts', line: 8, text: 'match', kind: 'symbol' }, null], relevant_files: [{ path: 'src/app.ts', symbols: [{ name: 'boot', kind: 'function', line: 8 }] }], hypotheses: [{ text: 'Startup path is involved', confidence: 'high', evidence: ['symbol match'] }], recommended_next_steps: ['Inspect caller'], limitations: ['Static analysis only'] })).toEqual({ question: '', summary: 'A finding', confirmedEvidence: [{ path: 'src/app.ts', line: 8, text: 'match', kind: 'symbol' }], relevantFiles: [{ path: 'src/app.ts', reason: '', symbols: [{ name: 'boot', kind: 'function', path: 'src/app.ts', line: 8 }] }], hypotheses: [{ text: 'Startup path is involved', confidence: 'high', evidence: ['symbol match'] }], recommendedNextSteps: ['Inspect caller'], limitations: ['Static analysis only'] })
  })
})

describe('normalizeAssistant', () => {
  it('normalizes a cited answer and removes malformed retrieval rows', () => {
    expect(normalizeAssistant({
      question: 'Where is greet?',
      answer: 'It is in the source.',
      provider: 'deterministic-fallback',
      citations: [{ id: 'repo-1', source: 'repository', path: 'src/app.py', line_start: 4, line_end: 4 }, { id: 2 }],
      retrieved: [{ id: 'repo-1', source: 'repository', category: 'repository', score: 0.8 }, { id: 2 }],
      limitations: ['Static evidence only'],
    })).toEqual({
      question: 'Where is greet?', answer: 'It is in the source.', provider: 'deterministic-fallback',
      citations: [{ id: 'repo-1', source: 'repository', path: 'src/app.py', lineStart: 4, lineEnd: 4 }],
      retrieved: [{ id: 'repo-1', source: 'repository', category: 'repository', score: 0.8 }],
      limitations: ['Static evidence only'],
    })
  })

  it('returns safe defaults for an unavailable assistant payload', () => {
    expect(normalizeAssistant({})).toEqual({ question: '', answer: '', provider: 'unknown', citations: [], retrieved: [], limitations: [] })
  })
})
