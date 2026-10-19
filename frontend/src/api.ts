export type Location = { path: string; line: number }
export type SymbolResult = { name: string; kind: string; location: Location }
export type ImportResult = { module: string; location: Location }
export type FileAnalysis = { path: string; language: string | null; size: number; symbols: SymbolResult[]; imports: ImportResult[]; status: string; limitation: string | null }
export type Analysis = { files: FileAnalysis[]; tree: Record<string, unknown>; languages: Record<string, number>; symbols: SymbolResult[]; imports: ImportResult[]; excluded: Array<{ path: string; reason: string }>; errors: Array<{ path: string; reason: string }> }
export type ImportResponse = { id: string; index?: { symbols: unknown[]; imports: unknown[] }; repository_name: string; source: { type: string; url?: string; filename?: string }; file_count: number; languages: Record<string, number>; symbol_count: number; import_count: number; tree: Record<string, unknown>; warnings: Array<{ path: string; reason: string }>; analysis: Analysis }

export const normalizeImport = (data: unknown): ImportResponse => {
  const root = objectValue(data)
  const id = textValue(root.id)
  const repositoryName = textValue(root.repository_name)
  const analysis = objectValue(root.analysis)
  if (!id || !repositoryName || !Array.isArray(analysis.files)) throw new Error('Import completed without a usable analysis result')
  return {
    id, repository_name: repositoryName,
    source: objectValue(root.source) as ImportResponse['source'],
    file_count: typeof root.file_count === 'number' ? root.file_count : analysis.files.length,
    languages: objectValue(root.languages) as Record<string, number>,
    symbol_count: typeof root.symbol_count === 'number' ? root.symbol_count : 0,
    import_count: typeof root.import_count === 'number' ? root.import_count : 0,
    tree: objectValue(root.tree),
    warnings: arrayValue(root.warnings).flatMap(item => { const value = objectValue(item); const path = textValue(value.path); return path ? [{ path, reason: textValue(value.reason) }] : [] }),
    analysis: analysis as unknown as Analysis,
    index: objectValue(root.index) as ImportResponse['index'],
  }
}

export type SearchResult = { path: string; line: number; text: string; kind: string; language: string | null }
export type InvestigationEvidence = { path: string; line: number | null; text: string; kind: string }
export type InvestigationSymbol = { name: string; kind: string; path: string; line: number | null }
export type InvestigationFile = { path: string; reason: string; symbols: InvestigationSymbol[] }
export type InvestigationHypothesis = { text: string; confidence: string; evidence: string[] }
export type Investigation = {
  question: string
  summary: string
  confirmedEvidence: InvestigationEvidence[]
  relevantFiles: InvestigationFile[]
  hypotheses: InvestigationHypothesis[]
  recommendedNextSteps: string[]
  limitations: string[]
}

const textValue = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : []

export const normalizeInvestigation = (data: unknown): Investigation => {
  const root = objectValue(data)
  const evidence = arrayValue(root.confirmed_evidence ?? root.confirmedEvidence ?? root.findings).flatMap((item) => {
    const value = objectValue(item)
    const path = textValue(value.path)
    const text = textValue(value.text ?? value.description)
    if (!path && !text) return []
    return [{ path, line: numberValue(value.line), text, kind: textValue(value.kind, 'evidence') }]
  })
  const relevantFiles = arrayValue(root.relevant_files ?? root.relevantFiles).flatMap((item) => {
    const value = typeof item === 'string' ? { path: item } : objectValue(item)
    const path = textValue(value.path)
    if (!path) return []
    const symbols = arrayValue(value.symbols).flatMap((symbol) => {
      const entry = typeof symbol === 'string' ? { name: symbol } : objectValue(symbol)
      const name = textValue(entry.name)
      return name ? [{ name, kind: textValue(entry.kind, 'symbol'), path: textValue(entry.path, path), line: numberValue(entry.line) }] : []
    })
    return [{ path, reason: textValue(value.reason), symbols }]
  })
  const hypotheses = arrayValue(root.hypotheses).flatMap((item) => {
    const value = objectValue(item)
    const text = textValue(value.text ?? value.hypothesis)
    if (!text) return []
    const evidenceLabels = arrayValue(value.evidence ?? value.evidence_labels ?? value.evidenceLabels).map(item => typeof item === 'string' ? item : textValue(objectValue(item).label ?? objectValue(item).text)).filter(Boolean)
    return [{ text, confidence: textValue(value.confidence, 'Unspecified'), evidence: evidenceLabels }]
  })
  const list = (value: unknown) => arrayValue(value).map(item => typeof item === 'string' ? item : textValue(objectValue(item).text ?? objectValue(item).step ?? objectValue(item).description)).filter(Boolean)
  return {
    question: textValue(root.question),
    summary: textValue(root.summary ?? root.overview),
    confirmedEvidence: evidence,
    relevantFiles,
    hypotheses,
    recommendedNextSteps: list(root.recommended_next_steps ?? root.recommendedNextSteps ?? root.next_steps),
    limitations: list(root.limitations ?? root.caveats),
  }
}
export type Graph = { nodes: Array<{ id: string; type?: string }>; edges: Array<{ from: string; to: string; evidence?: { line: number; kind: string; resolved?: boolean; module?: string } }>; limitations?: string[] }

const base = '/api/v1'
export type AuthUser = { id: string; email: string }

function csrfToken(): string | undefined {
  const entry = document.cookie.split('; ').find(value => value.startsWith('repopilot_csrf='))
  return entry ? decodeURIComponent(entry.slice('repopilot_csrf='.length)) : undefined
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase()
  const headers = new Headers(init?.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = csrfToken()
    if (token) headers.set('X-CSRF-Token', token)
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(base + url, { credentials: 'include', ...init, headers, signal: init?.signal || controller.signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    const error = new Error(body?.detail || `Request failed (${response.status})`)
    ;(error as Error & { status?: number }).status = response.status
    throw error
    }
    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The request timed out. Please retry.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export const normalizeSearch = (data: unknown): SearchResult[] => {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { results?: unknown }).results)) return []
  return (data as { results: unknown[] }).results.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const result = item as Partial<SearchResult>
    if (typeof result.path !== 'string' || typeof result.line !== 'number' || typeof result.text !== 'string') return []
    return [{ path: result.path, line: result.line, text: result.text, kind: typeof result.kind === 'string' && result.kind ? result.kind : 'content', language: typeof result.language === 'string' ? result.language : null }]
  })
}

export const importGithub = (url: string) => request<unknown>('/projects/import/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then(normalizeImport)
export const importArchive = (file: File) => { const form = new FormData(); form.append('file', file); return request<unknown>('/projects/import/archive', { method: 'POST', body: form }).then(normalizeImport) }
export const listProjects = () => request<{ projects: ImportResponse[] }>('/projects')
export const getProject = (id: string) => request<ImportResponse>(`/projects/${id}`)
export const deleteProject = (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' })
export const getTree = (id: string) => request<{ project_id: string; files: string[]; tree: Record<string, unknown>; excluded: Array<{ path: string; reason: string }> }>(`/projects/${id}/tree`)
export const getFile = (id: string, path: string) => request<{ path: string; content: string }>(`/projects/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`)
export const search = (id: string, query: string) => request<unknown>(`/projects/${id}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, limit: 50 }) }).then(normalizeSearch)
export type InvestigationInput = { question?: string; error_message?: string; stack_trace?: string; file?: string; symbol?: string; query?: string }
export const investigate = (id: string, input: InvestigationInput | string) => {
  const payload = typeof input === 'string' ? { question: input } : input
  return request<unknown>(`/projects/${id}/investigate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(normalizeInvestigation)
}
export const graph = (id: string) => request<Graph>(`/projects/${id}/graph`)
export const report = (id: string, input?: InvestigationInput) => request<{ markdown: string }>(`/projects/${id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) })
export const me = () => request<{ authenticated: boolean; user: AuthUser | null }>('/auth/me')
export const register = (email: string, password: string) => request<{ registered: boolean; email: string }>('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
export const login = (email: string, password: string) => request<{ user: AuthUser }>('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
export const logout = () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' })
