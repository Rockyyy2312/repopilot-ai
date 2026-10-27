export type Location = { path: string; line: number }
export type SymbolResult = { name: string; kind: string; location: Location }
export type ImportResult = { module: string; location: Location }
export type FileAnalysis = { path: string; language: string | null; size: number; symbols: SymbolResult[]; imports: ImportResult[]; status: string; limitation: string | null }
export type Analysis = { files: FileAnalysis[]; tree: Record<string, unknown>; languages: Record<string, number>; symbols: SymbolResult[]; imports: ImportResult[]; excluded: Array<{ path: string; reason: string }>; errors: Array<{ path: string; reason: string }> }
export type ProjectSummary = { id: string; repository_name: string; source: { type: string; url?: string; filename?: string }; file_count: number; languages: Record<string, number>; symbol_count: number; import_count: number; warning_count: number; created_at: number; accessed_at: number }
export type ImportResponse = { id: string; index?: { symbols: unknown[]; imports: unknown[] }; repository_name: string; source: { type: string; url?: string; filename?: string }; file_count: number; languages: Record<string, number>; symbol_count: number; import_count: number; tree: Record<string, unknown>; warnings: Array<{ path: string; reason: string }>; analysis: Analysis }

type JsonObject = Record<string, unknown>

const textValue = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const objectValue = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const booleanValue = (value: unknown, fallback = false): boolean => typeof value === 'boolean' ? value : fallback

const normalizeLocation = (value: unknown): Location => {
  const entry = objectValue(value)
  return { path: textValue(entry.path), line: numberValue(entry.line) ?? 0 }
}

const normalizeSymbol = (value: unknown): SymbolResult | null => {
  const entry = objectValue(value)
  const name = textValue(entry.name)
  if (!name) return null
  return { name, kind: textValue(entry.kind, 'symbol'), location: normalizeLocation(entry.location || entry) }
}

const normalizeImportEntry = (value: unknown): ImportResult | null => {
  const entry = objectValue(value)
  const module = textValue(entry.module)
  if (!module) return null
  return { module, location: normalizeLocation(entry.location || entry) }
}

const normalizeFileAnalysis = (value: unknown): FileAnalysis | null => {
  const entry = objectValue(value)
  const path = textValue(entry.path)
  if (!path) return null
  return {
    path,
    language: typeof entry.language === 'string' ? entry.language : null,
    size: numberValue(entry.size) ?? 0,
    symbols: arrayValue(entry.symbols).flatMap(item => { const symbol = normalizeSymbol(item); return symbol ? [symbol] : [] }),
    imports: arrayValue(entry.imports).flatMap(item => { const imported = normalizeImportEntry(item); return imported ? [imported] : [] }),
    status: textValue(entry.status, 'analyzed'),
    limitation: typeof entry.limitation === 'string' ? entry.limitation : null,
  }
}

const normalizeAnalysis = (value: unknown): Analysis => {
  const entry = objectValue(value)
  const files = arrayValue(entry.files).flatMap(item => { const file = normalizeFileAnalysis(item); return file ? [file] : [] })
  const symbols = arrayValue(entry.symbols).flatMap(item => { const symbol = normalizeSymbol(item); return symbol ? [symbol] : [] })
  const imports = arrayValue(entry.imports).flatMap(item => { const imported = normalizeImportEntry(item); return imported ? [imported] : [] })
  const excluded = arrayValue(entry.excluded).flatMap(item => { const warning = objectValue(item); const path = textValue(warning.path); return path ? [{ path, reason: textValue(warning.reason) }] : [] })
  const errors = arrayValue(entry.errors).flatMap(item => { const warning = objectValue(item); const path = textValue(warning.path); return path ? [{ path, reason: textValue(warning.reason) }] : [] })
  return { files, tree: objectValue(entry.tree), languages: objectValue(entry.languages) as Record<string, number>, symbols, imports, excluded, errors }
}

export const normalizeImport = (data: unknown): ImportResponse => {
  const root = objectValue(data)
  const id = textValue(root.id)
  const repositoryName = textValue(root.repository_name)
  const rawAnalysis = objectValue(root.analysis)
  if (!id || !repositoryName || !Array.isArray(rawAnalysis.files)) throw new Error('Import completed without a usable analysis result')
  const analysis = normalizeAnalysis(rawAnalysis)
  return {
    id, repository_name: repositoryName,
    source: normalizeSource(root.source),
    file_count: typeof root.file_count === 'number' ? root.file_count : analysis.files.length,
    languages: objectValue(root.languages) as Record<string, number>,
    symbol_count: typeof root.symbol_count === 'number' ? root.symbol_count : 0,
    import_count: typeof root.import_count === 'number' ? root.import_count : 0,
    tree: objectValue(root.tree),
    warnings: arrayValue(root.warnings).flatMap(item => { const value = objectValue(item); const path = textValue(value.path); return path ? [{ path, reason: textValue(value.reason) }] : [] }),
    analysis,
    index: objectValue(root.index) as ImportResponse['index'],
  }
}

const normalizeSource = (value: unknown): ImportResponse['source'] => {
  const source = objectValue(value)
  return { type: textValue(source.type, 'unknown'), url: textValue(source.url) || undefined, filename: textValue(source.filename) || undefined }
}

export const normalizeProjectSummary = (value: unknown): ProjectSummary | null => {
  const entry = objectValue(value)
  const id = textValue(entry.id); const repositoryName = textValue(entry.repository_name)
  if (!id || !repositoryName) return null
  return { id, repository_name: repositoryName, source: normalizeSource(entry.source), file_count: numberValue(entry.file_count) ?? 0, languages: objectValue(entry.languages) as Record<string, number>, symbol_count: numberValue(entry.symbol_count) ?? 0, import_count: numberValue(entry.import_count) ?? 0, warning_count: numberValue(entry.warning_count) ?? 0, created_at: numberValue(entry.created_at) ?? 0, accessed_at: numberValue(entry.accessed_at) ?? 0 }
}

export const normalizeProjectList = (data: unknown): { projects: ProjectSummary[] } => {
  const root = objectValue(data)
  return { projects: arrayValue(root.projects).flatMap(item => { const summary = normalizeProjectSummary(item); return summary ? [summary] : [] }) }
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

export type AssistantCitation = { id: string; source: string; path?: string; lineStart?: number; lineEnd?: number }
export type AssistantRetrieved = { id: string; source: string; category: string; score: number }
export type AssistantResponse = { question: string; answer: string; provider: string; citations: AssistantCitation[]; retrieved: AssistantRetrieved[]; limitations: string[] }

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

export const normalizeAssistant = (data: unknown): AssistantResponse => {
  const root = objectValue(data)
  const citations = arrayValue(root.citations).flatMap(item => {
    const value = objectValue(item)
    const id = textValue(value.id); const source = textValue(value.source)
    if (!id || !source) return []
    const path = textValue(value.path) || undefined
    return [{ id, source, ...(path ? { path } : {}), ...(numberValue(value.line_start) !== null ? { lineStart: numberValue(value.line_start) as number } : {}), ...(numberValue(value.line_end) !== null ? { lineEnd: numberValue(value.line_end) as number } : {}) }]
  })
  const retrieved = arrayValue(root.retrieved).flatMap(item => {
    const value = objectValue(item)
    const id = textValue(value.id); const source = textValue(value.source); const category = textValue(value.category)
    if (!id || !source || !category) return []
    return [{ id, source, category, score: numberValue(value.score) ?? 0 }]
  })
  const list = (value: unknown) => arrayValue(value).map(item => textValue(item)).filter(Boolean)
  return { question: textValue(root.question), answer: textValue(root.answer), provider: textValue(root.provider, 'unknown'), citations, retrieved, limitations: list(root.limitations) }
}
export type Overview = {
  project_id: string
  indexed_at: number
  total_lines: number
  total_bytes: number
  analyzed_files: number
  packages: Array<{ path: string; files: number; lines: number; symbols: number }>
  languages: Array<{ name: string; files: number; lines: number }>
  dependencies: Array<{ name: string; version: string; path: string }>
  warnings: Array<{ path: string; reason: string }>
}
export type SearchPage = { results: SearchResult[]; total_matches: number; total_files: number; has_more: boolean; elapsed_ms: number }
export type Preferences = { display_name: string; reduced_motion: boolean; compact_mode: boolean }
export type Graph = { nodes: Array<{ id: string; type?: string }>; edges: Array<{ from: string; to: string; evidence?: { line: number; kind: string; resolved?: boolean; module?: string } }>; limitations?: string[]; truncated?: { nodes: boolean; edges: boolean; total_nodes: number; total_edges: number; scope?: string; depth?: number; limit?: number } }
export type Job = { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; progress: number; message: string; result?: unknown; error?: string; created_at: number; started_at?: number; finished_at?: number; updated_at: number }

export const normalizeOverview = (data: unknown): Overview => {
  const root = objectValue(data)
  const rows = (value: unknown, fields: string[]) => arrayValue(value).flatMap(item => {
    const row = objectValue(item)
    const name = textValue(row[fields[0]])
    if (!name) return []
    return [{ name, files: numberValue(row.files) ?? 0, lines: numberValue(row.lines) ?? 0, ...(fields.includes('symbols') ? { symbols: numberValue(row.symbols) ?? 0 } : {}) }]
  })
  const packages = arrayValue(root.packages).flatMap(item => { const row = objectValue(item); const path = textValue(row.path); return path ? [{ path, files: numberValue(row.files) ?? 0, lines: numberValue(row.lines) ?? 0, symbols: numberValue(row.symbols) ?? 0 }] : [] })
  const dependencies = arrayValue(root.dependencies).flatMap(item => { const row = objectValue(item); const name = textValue(row.name); return name ? [{ name, version: textValue(row.version), path: textValue(row.path) }] : [] })
  const warnings = arrayValue(root.warnings).flatMap(item => { const row = objectValue(item); const path = textValue(row.path); return path ? [{ path, reason: textValue(row.reason) }] : [] })
  return {
    project_id: textValue(root.project_id), indexed_at: numberValue(root.indexed_at) ?? 0,
    total_lines: numberValue(root.total_lines) ?? 0, total_bytes: numberValue(root.total_bytes) ?? 0,
    analyzed_files: numberValue(root.analyzed_files) ?? 0, packages,
    languages: rows(root.languages, ['name']), dependencies, warnings,
  }
}

export const normalizePreferences = (data: unknown): Preferences => {
  const root = objectValue(data)
  return { display_name: textValue(root.display_name), reduced_motion: booleanValue(root.reduced_motion), compact_mode: booleanValue(root.compact_mode) }
}

export const normalizeSearchPage = (data: unknown): SearchPage => {
  const root = Array.isArray(data) ? { results: data } : objectValue(data)
  const results = arrayValue(root.results).flatMap(item => {
    const result = objectValue(item)
    const path = textValue(result.path); const text = textValue(result.text); const line = numberValue(result.line)
    if (!path || !text || line === null) return []
    return [{ path, line, text, kind: textValue(result.kind, 'content'), language: typeof result.language === 'string' ? result.language : null }]
  })
  return { results, total_matches: numberValue(root.total_matches) ?? results.length, total_files: numberValue(root.total_files) ?? new Set(results.map(item => item.path)).size, has_more: booleanValue(root.has_more), elapsed_ms: numberValue(root.elapsed_ms) ?? 0 }
}

export const normalizeGraph = (data: unknown): Graph => {
  const root = objectValue(data)
  const nodes = arrayValue(root.nodes).flatMap(item => { const node = objectValue(item); const id = textValue(node.id); return id ? [{ id, type: textValue(node.type) || undefined }] : [] })
  const edges = arrayValue(root.edges).flatMap(item => {
    const edge = objectValue(item); const from = textValue(edge.from || edge.source); const to = textValue(edge.to || edge.target)
    if (!from || !to) return []
    const rawEvidence = objectValue(edge.evidence)
    const evidence = Object.keys(rawEvidence).length ? { line: numberValue(rawEvidence.line) ?? 0, kind: textValue(rawEvidence.kind, 'import'), resolved: typeof rawEvidence.resolved === 'boolean' ? rawEvidence.resolved : undefined, module: textValue(rawEvidence.module) || undefined } : undefined
    return [{ from, to, ...(evidence ? { evidence } : {}) }]
  })
  const limitations = arrayValue(root.limitations).map(item => textValue(item)).filter(Boolean)
  const rawTruncation = objectValue(root.truncated)
  const truncated = Object.keys(rawTruncation).length ? { nodes: booleanValue(rawTruncation.nodes), edges: booleanValue(rawTruncation.edges), total_nodes: numberValue(rawTruncation.total_nodes) ?? nodes.length, total_edges: numberValue(rawTruncation.total_edges) ?? edges.length, scope: textValue(rawTruncation.scope) || undefined, depth: numberValue(rawTruncation.depth) ?? undefined, limit: numberValue(rawTruncation.limit) ?? undefined } : undefined
  return { nodes, edges, limitations, ...(truncated ? { truncated } : {}) }
}

const apiBase = () => (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '')
export type AuthUser = { id: string; email: string }

const errorWithStatus = (message: string, status?: number): Error & { status?: number } => {
  const error = new Error(message) as Error & { status?: number }
  if (status !== undefined) error.status = status
  return error
}

const validationMessage = (body: unknown, status: number): string => {
  const detail = objectValue(body).detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const issues = detail.flatMap(item => {
      const issue = objectValue(item)
      const location = arrayValue(issue.loc).map(value => textValue(value)).filter(Boolean).join('.')
      const message = textValue(issue.msg ?? issue.message ?? issue.detail)
      return message ? [location ? `${location}: ${message}` : message] : []
    })
    if (issues.length) return status === 422 ? `Validation failed: ${issues.join('; ')}` : issues.join('; ')
  }
  if (typeof body === 'string' && body.trim()) return body
  return `Request failed (${status})`
}

function csrfToken(): string | undefined {
  const entry = document.cookie.split('; ').find(value => value.startsWith('repopilot_csrf='))
  return entry ? decodeURIComponent(entry.slice('repopilot_csrf='.length)) : undefined
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase()
  const headers = new Headers(init?.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = csrfToken()
    if (token) headers.set('X-CSRF-Token', token)
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(apiBase() + url, { credentials: 'include', ...init, headers, signal: init?.signal || controller.signal })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw errorWithStatus(validationMessage(body, response.status), response.status)
    }
    if (response.status === 204) return undefined as T
    const data = await response.json()
    return normalizePayload(url, data) as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw errorWithStatus('The request timed out. Please retry.')
    if (error instanceof TypeError) throw errorWithStatus('Unable to reach the API. Check your connection and try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

const normalizePayload = (url: string, data: unknown): unknown => {
  if (url === '/projects') return normalizeProjectList(data)
  if (/^\/projects\/[^/]+\/overview$/.test(url)) return normalizeOverview(data)
  if (/^\/projects\/[^/]+\/search$/.test(url)) return normalizeSearchPage(data)
  if (url === '/users/me/preferences') return normalizePreferences(data)
  if (/^\/projects\/[^/]+\/graph(?:\?.*)?$/.test(url)) return normalizeGraph(data)
  if (/^\/jobs\/[^/]+$/.test(url)) return normalizeJob(data)
  if (/^\/projects\/[^/]+\/assistant$/.test(url)) return normalizeAssistant(data)
  if (/^\/projects\/[^/]+$/.test(url)) return normalizeImport(data)
  return data
}

export const normalizeJob = (data: unknown): Job => {
  const root = objectValue(data)
  const id = textValue(root.id)
  if (!id) throw new Error('Job response did not include an id')
  const status = textValue(root.status, 'failed') as Job['status']
  if (!['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(status)) throw new Error('Job response included an invalid status')
  return { id, status, progress: Math.max(0, Math.min(1, numberValue(root.progress) ?? 0)), message: textValue(root.message), result: root.result, error: textValue(root.error) || undefined, created_at: numberValue(root.created_at) ?? 0, started_at: numberValue(root.started_at) ?? undefined, finished_at: numberValue(root.finished_at) ?? undefined, updated_at: numberValue(root.updated_at) ?? 0 }
}

export const normalizeSearch = (data: unknown): SearchResult[] => {
  return normalizeSearchPage(data).results
}

export const importGithub = (url: string) => request<unknown>('/projects/import/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then(normalizeImport)
export const importArchive = (file: File) => { const form = new FormData(); form.append('file', file); return request<unknown>('/projects/import/archive', { method: 'POST', body: form }).then(normalizeImport) }
export const listProjects = () => request<{ projects: ProjectSummary[] }>('/projects')
export const getProject = (id: string) => request<ImportResponse>(`/projects/${encodeURIComponent(id)}`).then(normalizeImport)
export const deleteProject = (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' })
export const getTree = (id: string) => request<{ project_id: string; files: string[]; tree: Record<string, unknown>; excluded: Array<{ path: string; reason: string }> }>(`/projects/${id}/tree`)
export const getFile = (id: string, path: string) => request<{ path: string; content: string }>(`/projects/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`)
export const search = (id: string, query: string) => request<unknown>(`/projects/${id}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, limit: 50 }) }).then(normalizeSearch)
export type InvestigationInput = { question?: string; error_message?: string; stack_trace?: string; file?: string; symbol?: string; query?: string }
export const investigate = (id: string, input: InvestigationInput | string) => {
  const payload = typeof input === 'string' ? { question: input } : input
  return request<unknown>(`/projects/${id}/investigate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(normalizeInvestigation)
}
export const askAssistant = (id: string, question: string, top_k = 5) => request<AssistantResponse>(`/projects/${encodeURIComponent(id)}/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, top_k }) })
export const graph = (id: string, options?: { scope?: string; depth?: number; limit?: number }) => { const params = new URLSearchParams(); if (options?.scope) params.set('scope', options.scope); if (options?.depth !== undefined) params.set('depth', String(options.depth)); if (options?.limit !== undefined) params.set('limit', String(options.limit)); const suffix = params.toString() ? `?${params}` : ''; return request<Graph>(`/projects/${encodeURIComponent(id)}/graph${suffix}`) }
export const report = (id: string, input?: InvestigationInput) => request<{ markdown: string }>(`/projects/${id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) })
export const me = () => request<{ authenticated: boolean; user: AuthUser | null }>('/auth/me')
export const register = (email: string, password: string) => request<{ registered: boolean; email: string }>('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
export const login = (email: string, password: string) => request<{ user: AuthUser }>('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
export const logout = () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' })
export const startImportJobGithub = (url: string) => request<Job>('/projects/import/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'github', url }) }).then(normalizeJob)
export const startImportJobArchive = (file: File) => { const form = new FormData(); form.append('file', file); return request<Job>('/projects/import/jobs', { method: 'POST', body: form }).then(normalizeJob) }
export const getJob = (id: string) => request<Job>(`/jobs/${encodeURIComponent(id)}`).then(normalizeJob)
export const cancelJob = (id: string) => request<Job>(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).then(normalizeJob)
