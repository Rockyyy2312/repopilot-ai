import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as api from './api'

vi.mock('./api', () => ({
  me: vi.fn(), listProjects: vi.fn(), login: vi.fn(), register: vi.fn(),
  logout: vi.fn(),
  importGithub: vi.fn(), importArchive: vi.fn(), getTree: vi.fn(), getFile: vi.fn(),
  search: vi.fn(), investigate: vi.fn(), graph: vi.fn(), report: vi.fn(), deleteProject: vi.fn(),
}))

describe('App workspace shell', () => {
  let root: Root
  afterEach(() => { act(() => { root?.unmount() }) })

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

  it('shows a validation error without sending an invalid GitHub URL', async () => {
    await act(async () => { root.render(<App />) })
    await act(async () => { await Promise.resolve() })
    const input = document.querySelector('input[aria-label="GitHub repository URL"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'https://example.com/not-github')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const importButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Import repository')) as HTMLButtonElement
    await act(async () => { importButton.click() })
    expect(api.importGithub).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Enter a valid public GitHub repository URL')
  })

  it('loads the returned project tree after a successful import', async () => {
    vi.mocked(api.importGithub).mockResolvedValue({ id: 'p1', repository_name: 'repo', source: { type: 'github', url: 'https://github.com/owner/repo' }, file_count: 1, languages: { python: 1 }, symbol_count: 0, import_count: 0, tree: {}, warnings: [], analysis: { files: [], tree: {}, languages: {}, symbols: [], imports: [], excluded: [], errors: [] } })
    vi.mocked(api.getTree).mockResolvedValue({ project_id: 'p1', files: ['repo/main.py'], tree: {}, excluded: [] })
    await act(async () => { root.render(<App />) })
    await act(async () => { await Promise.resolve() })
    const input = document.querySelector('input[aria-label="GitHub repository URL"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'https://github.com/owner/repo')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const importButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Import repository')) as HTMLButtonElement
    await act(async () => { importButton.click(); await Promise.resolve() })
    expect(api.importGithub).toHaveBeenCalledWith('https://github.com/owner/repo')
    expect(api.getTree).toHaveBeenCalledWith('p1')
    expect(document.body.textContent).toContain('repo')
  })
})


describe('empty workspace navigation', () => {
  let navRoot: Root
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/workspace')
    vi.mocked(api.me).mockResolvedValue({ authenticated: true, user: { id: 'u1', email: 'dev@example.com' } })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [] })
    navRoot = createRoot(document.getElementById('root')!)
  })
  afterEach(() => { act(() => { navRoot?.unmount() }) })
  it('keeps each workspace destination distinct before import', async () => {
    await act(async () => { navRoot.render(<App />) })
    await act(async () => { await Promise.resolve() })
    const click = async (label: string, heading: string) => {
      const button = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes(label)) as HTMLButtonElement
      await act(async () => { button.click() })
      expect(document.querySelector('.empty-route h2')?.textContent).toBe(heading)
    }
    await click('Code search', 'Code search')
    await click('Investigate issue', 'Investigate an issue')
    await click('Architecture', 'Architecture map')
    await click('Settings', 'Settings')
  })
})

describe('repository-aware workspace pages', () => {
  let workspaceRoot: Root
  const project = { id: 'p1', repository_name: 'repo-one', source: { type: 'github', url: 'https://github.com/owner/repo-one' }, file_count: 2, languages: { python: 2 }, symbol_count: 1, import_count: 1, tree: {}, warnings: [], analysis: { files: [{ path: 'main.py', language: 'python', size: 10, symbols: [], imports: [], status: 'analyzed', limitation: null }], tree: {}, languages: { python: 2 }, symbols: [], imports: [], excluded: [], errors: [] } }
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/workspace')
    localStorage.clear()
    vi.mocked(api.me).mockResolvedValue({ authenticated: true, user: { id: 'u1', email: 'dev@example.com' } })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [project] })
    vi.mocked(api.getTree).mockResolvedValue({ project_id: 'p1', files: ['main.py'], tree: {}, excluded: [] })
    localStorage.setItem('repopilot.last_project.u1', 'p1')
    workspaceRoot = createRoot(document.getElementById('root')!)
  })
  afterEach(() => { act(() => { workspaceRoot?.unmount() }) })

  it('uses distinct page headings while keeping the selected repository', async () => {
    await act(async () => { workspaceRoot.render(<App />); await Promise.resolve() })
    expect(document.querySelector('h1')?.textContent).toBe('Understand your codebase.')
    expect(document.body.textContent).toContain('repo-one')
    const searchButton = Array.from(document.querySelectorAll('nav button')).find(button => button.textContent?.includes('Code search')) as HTMLButtonElement
    await act(async () => { searchButton.click() })
    expect(document.querySelector('h1')?.textContent).toBe('Find exact source evidence.')
    expect(document.body.textContent).toContain('repo-one')
    const settingsButton = Array.from(document.querySelectorAll('nav button')).find(button => button.textContent?.includes('Settings')) as HTMLButtonElement
    await act(async () => { settingsButton.click() })
    expect(document.querySelector('h1')?.textContent).toBe('Control this workspace.')
    const repositoriesButton = Array.from(document.querySelectorAll('nav button')).find(button => button.textContent?.includes('Repositories')) as HTMLButtonElement
    await act(async () => { repositoriesButton.click() })
    expect(document.querySelector('h1')?.textContent).toBe('Manage indexed codebases.')
    expect(document.body.textContent).toContain('repo-one')
  })

  it('persists the supported reduced-motion setting', async () => {
    await act(async () => { workspaceRoot.render(<App />); await Promise.resolve() })
    const settingsButton = Array.from(document.querySelectorAll('nav button')).find(button => button.textContent?.includes('Settings')) as HTMLButtonElement
    await act(async () => { settingsButton.click() })
    const toggle = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => { toggle.click() })
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
    expect(localStorage.getItem('repopilot.settings.u1')).toContain('"reducedMotion":true')
  })

  it('shows a visible API error and retry affordance for search failures', async () => {
    vi.mocked(api.search).mockRejectedValueOnce(new Error('Search service unavailable'))
    await act(async () => { workspaceRoot.render(<App />); await Promise.resolve() })
    const searchButton = Array.from(document.querySelectorAll('nav button')).find(button => button.textContent?.includes('Code search')) as HTMLButtonElement
    await act(async () => { searchButton.click() })
    const input = document.querySelector('input[aria-label="Search query"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => { setter?.call(input, 'startup'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const submit = document.querySelector('.search-row button') as HTMLButtonElement
    await act(async () => { submit.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(api.search).toHaveBeenCalledWith('p1', 'startup')
    expect(document.body.textContent).toContain('Search service unavailable')
    expect(document.body.textContent).toContain('Retry')
  })
})

describe('authentication flow', () => {
  let authRoot: Root
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/')
    vi.mocked(api.me).mockResolvedValue({ authenticated: false, user: null })
    vi.mocked(api.register).mockResolvedValue({ registered: true, email: 'new@example.com' })
    authRoot = createRoot(document.getElementById('root')!)
  })
  afterEach(() => { act(() => { authRoot?.unmount() }) })
  it('keeps registration separate from login', async () => {
    await act(async () => { authRoot.render(<App />) })
    await act(async () => { await Promise.resolve() })
    const switchButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Need an account')) as HTMLButtonElement
    await act(async () => { switchButton.click() })
    const email = document.querySelector('input[type="email"]') as HTMLInputElement
    const password = document.querySelector('input[type="password"]') as HTMLInputElement
    await act(async () => {
      const set = (element: HTMLInputElement, value: string) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) }
      set(email, 'new@example.com'); set(password, 'correct horse battery')
      document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(api.register).toHaveBeenCalledWith('new@example.com', 'correct horse battery')
    expect(api.login).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/login')
    expect(document.body.textContent).toContain('Account created successfully')
  })
})
