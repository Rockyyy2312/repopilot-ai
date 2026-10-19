import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as api from './api'

vi.mock('./api', () => ({
  me: vi.fn(), listProjects: vi.fn(),
  logout: vi.fn(),
  importGithub: vi.fn(), importArchive: vi.fn(), getTree: vi.fn(), getFile: vi.fn(),
  search: vi.fn(), investigate: vi.fn(), graph: vi.fn(), report: vi.fn(), deleteProject: vi.fn(),
}))

describe('App workspace shell', () => {
  let root: Root
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/')
    sessionStorage.clear()
    localStorage.clear()
    vi.mocked(api.me).mockResolvedValue({ authenticated: true, user: { id: 'u1', email: 'dev@example.com' } })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [] })
    root = createRoot(document.getElementById('root')!)
  })
  it('renders the import workspace and all primary navigation affordances', async () => {
    await act(async () => { root.render(<App />) })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain('Import from GitHub')
    expect(document.body.textContent).toContain('Settings')
    expect(document.body.textContent).toContain('Code search')
    expect(document.querySelector('aside')).not.toBeNull()
  })
})
