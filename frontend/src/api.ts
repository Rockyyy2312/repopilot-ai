export type Location = { path: string; line: number }
export type SymbolResult = { name: string; kind: string; location: Location }
export type ImportResult = { module: string; location: Location }
export type FileAnalysis = { path: string; language: string | null; size: number; symbols: SymbolResult[]; imports: ImportResult[]; status: string; limitation: string | null }
export type Analysis = { files: FileAnalysis[]; tree: Record<string, unknown>; languages: Record<string, number>; symbols: SymbolResult[]; imports: ImportResult[]; excluded: Array<{ path: string; reason: string }>; errors: Array<{ path: string; reason: string }> }
export type ImportResponse = { id: string; repository_name: string; source: { type: string; url?: string; filename?: string }; file_count: number; languages: Record<string, number>; symbol_count: number; import_count: number; tree: Record<string, unknown>; warnings: Array<{ path: string; reason: string }>; analysis: Analysis }
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
export type Graph = { nodes: Array<{ id: string; type?: string }>; edges: Array<{ from: string; to: string; evidence?: { line: number; kind: string } }> }

const base = '/api/v1'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(base + url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
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

export const importGithub = (url: string) => request<ImportResponse>('/projects/import/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
export const importArchive = (file: File) => { const form = new FormData(); form.append('file', file); return request<ImportResponse>('/projects/import/archive', { method: 'POST', body: form }) }
export const getTree = (id: string) => request<{ project_id: string; files: string[]; tree: Record<string, unknown>; excluded: Array<{ path: string; reason: string }> }>(`/projects/${id}/tree`)
export const getFile = (id: string, path: string) => request<{ path: string; content: string }>(`/projects/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`)
export const search = (id: string, query: string) => request<unknown>(`/projects/${id}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, limit: 50 }) }).then(normalizeSearch)
export type InvestigationInput = { question: string; error_message?: string; stack_trace?: string; file?: string; symbol?: string }
export const investigate = (id: string, input: InvestigationInput | string) => {
  const payload = typeof input === 'string' ? { question: input } : input
  return request<unknown>(`/projects/${id}/investigate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(normalizeInvestigation)
}
export const graph = (id: string) => request<Graph>(`/projects/${id}/graph`)
export const report = (id: string) => request<{ markdown: string }>(`/projects/${id}/report`)
