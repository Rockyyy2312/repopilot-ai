export type Location = { path: string; line: number }
export type SymbolResult = { name: string; kind: string; location: Location }
export type ImportResult = { module: string; location: Location }
export type FileAnalysis = { path: string; language: string | null; size: number; symbols: SymbolResult[]; imports: ImportResult[]; status: string; limitation: string | null }
export type Analysis = { files: FileAnalysis[]; tree: Record<string, unknown>; languages: Record<string, number>; symbols: SymbolResult[]; imports: ImportResult[]; excluded: Array<{ path: string; reason: string }>; errors: Array<{ path: string; reason: string }> }
export type ImportResponse = { id: string; repository_name: string; source: { type: string; url?: string; filename?: string }; file_count: number; languages: Record<string, number>; symbol_count: number; import_count: number; tree: Record<string, unknown>; warnings: Array<{ path: string; reason: string }>; analysis: Analysis }
export type SearchResult = { path: string; line: number; text: string; kind: string; language: string | null }
export type Investigation = { question: string; findings: Array<Record<string, unknown>>; hypotheses: Array<Record<string, unknown>> }
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
export const investigate = (id: string, question: string) => request<Investigation>(`/projects/${id}/investigate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) })
export const graph = (id: string) => request<Graph>(`/projects/${id}/graph`)
export const report = (id: string) => request<{ markdown: string }>(`/projects/${id}/report`)
