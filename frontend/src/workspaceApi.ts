import { request, type Overview, type Preferences, type SearchPage } from './api'

export type SearchInput = { query: string; path?: string; language?: string; kind?: string; offset?: number; limit?: number }

export const getOverview = (id: string): Promise<Overview> => request<Overview>(`/projects/${encodeURIComponent(id)}/overview`)
export const searchPage = (id: string, input: SearchInput): Promise<SearchPage> => request<SearchPage>(`/projects/${encodeURIComponent(id)}/search`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
})
export const getPreferences = (): Promise<Preferences> => request<Preferences>('/users/me/preferences')
export const updatePreferences = (input: Partial<Preferences>): Promise<Preferences> => request<Preferences>('/users/me/preferences', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
})
