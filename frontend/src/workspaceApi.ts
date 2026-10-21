import { request, type SearchResult } from './api'

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

export type SearchInput = { query: string; path?: string; language?: string; kind?: string; offset?: number; limit?: number }
export type SearchPage = { results: SearchResult[]; total_matches: number; total_files: number; has_more: boolean; elapsed_ms: number }
export type Preferences = { display_name: string; reduced_motion: boolean; compact_mode: boolean }

export const getOverview = (id: string): Promise<Overview> => request<Overview>(`/projects/${encodeURIComponent(id)}/overview`)
export const searchPage = (id: string, input: SearchInput): Promise<SearchPage> => request<SearchPage>(`/projects/${encodeURIComponent(id)}/search`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
})
export const getPreferences = (): Promise<Preferences> => request<Preferences>('/users/me/preferences')
export const updatePreferences = (input: Partial<Preferences>): Promise<Preferences> => request<Preferences>('/users/me/preferences', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
})
