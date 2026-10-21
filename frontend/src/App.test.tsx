import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as api from './api'

vi.mock('./api', () => ({
  request: vi.fn(), me: vi.fn(), listProjects: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(),
  importGithub: vi.fn(), importArchive: vi.fn(), getTree: vi.fn(), getFile: vi.fn(), search: vi.fn(),
  investigate: vi.fn(), graph: vi.fn(), report: vi.fn(), deleteProject: vi.fn(), startImportJobGithub: vi.fn(), startImportJobArchive: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(), normalizeImport: (value: unknown) => value,
}))

const project = { id: 'p1', repository_name: 'repo-one', source: { type: 'github', url: 'https://github.com/owner/repo-one' }, file_count: 2, languages: { python: 2 }, symbol_count: 1, import_count: 1, warning_count: 0, created_at: 1_700_000_000, accessed_at: 1_700_000_000, tree: {}, warnings: [], analysis: { files: [{ path: 'main.py', language: 'python', size: 10, symbols: [], imports: [], status: 'analyzed', limitation: null }], tree: {}, languages: { python: 2 }, symbols: [], imports: [], excluded: [], errors: [] } }
const overview = { project_id: 'p1', indexed_at: 1_700_000_000, total_lines: 42, total_bytes: 400, analyzed_files: 1, packages: [], languages: [{ name: 'python', files: 2, lines: 42 }], dependencies: [], warnings: [] }

function defaultRequest(url: string): Promise<unknown> {
  if (url.endsWith('/overview')) return Promise.resolve(overview)
  if (url.includes('/preferences')) return Promise.resolve({ display_name: '', reduced_motion: false, compact_mode: false })
  if (url.includes('/search')) return Promise.resolve({ results: [], total_matches: 0, total_files: 0, has_more: false, elapsed_ms: 1 })
  return Promise.resolve({})
}

describe('workspace screen routing', () => {
  let root: Root
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/workspace')
    sessionStorage.clear(); localStorage.clear()
    vi.mocked(api.me).mockResolvedValue({ authenticated: true, user: { id: 'u1', email: 'dev@example.com' } })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [] })
    vi.mocked(api.request).mockImplementation((url: string) => defaultRequest(url) as never)
    root = createRoot(document.getElementById('root')!)
  })
  afterEach(() => { act(() => { root?.unmount() }) })

  it('renders the Stitch repository management scene without a project', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const repositories = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes('Repositories')) as HTMLButtonElement
    await act(async () => { repositories.click() })
    expect(document.body.textContent).toContain('Connect Remote Provider')
    expect(document.body.textContent).toContain('Upload Local Source')
    expect(document.body.textContent).toContain('Code Search')
    expect(document.querySelector('aside')).not.toBeNull()
  })

  it('validates an invalid GitHub URL without calling the import API', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const repositories = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes('Repositories')) as HTMLButtonElement
    await act(async () => { repositories.click() })
    const input = document.querySelector('input[aria-label="GitHub repository URL"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => { setter?.call(input, 'https://example.com/not-github'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Import repository')) as HTMLButtonElement
    await act(async () => { button.click() })
    expect(api.importGithub).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Enter a valid public GitHub repository URL')
  })

  it('loads an imported project into the overview screen', async () => {
    vi.mocked(api.startImportJobGithub).mockResolvedValue({ id: 'job-1', status: 'succeeded', progress: 1, message: 'Import completed', result: project, created_at: 1, updated_at: 1 })
    vi.mocked(api.getTree).mockResolvedValue({ project_id: 'p1', files: ['main.py'], tree: {}, excluded: [] })
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const repositories = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes('Repositories')) as HTMLButtonElement
    await act(async () => { repositories.click() })
    const input = document.querySelector('input[aria-label="GitHub repository URL"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => { setter?.call(input, 'https://github.com/owner/repo'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Import repository')) as HTMLButtonElement
    await act(async () => { button.click(); await Promise.resolve() })
    expect(api.startImportJobGithub).toHaveBeenCalledWith('https://github.com/owner/repo')
    expect(document.body.textContent).toContain('Codebase Overview')
  })

  it('keeps each supplied workspace scene distinct before import', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const click = async (label: string, heading: string) => {
      const button = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes(label)) as HTMLButtonElement
      await act(async () => { button.click() })
      expect(document.querySelector('h1')?.textContent).toBe(heading)
    }
    await click('Code Search', 'Find source evidence')
    await click('Issue Assistant', 'Investigate an issue')
    await click('Architecture', 'Architecture Canvas')
    await click('Settings', 'Account & Workspace Settings')
  })
})

describe('repository-aware screens', () => {
  let root: Root
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/workspace')
    vi.mocked(api.me).mockResolvedValue({ authenticated: true, user: { id: 'u1', email: 'dev@example.com' } })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [project] })
    vi.mocked(api.getTree).mockResolvedValue({ project_id: 'p1', files: ['main.py'], tree: {}, excluded: [] })
    vi.mocked(api.getFile).mockResolvedValue({ path: 'main.py', content: 'print(1)' })
    vi.mocked(api.graph).mockResolvedValue({ nodes: [{ id: 'main.py', type: 'file' }], edges: [], limitations: [] })
    vi.mocked(api.request).mockImplementation((url: string) => defaultRequest(url) as never)
    localStorage.setItem('repopilot.last_project.u1', 'p1')
    root = createRoot(document.getElementById('root')!)
  })
  afterEach(() => { act(() => { root?.unmount() }) })

  it('renders the redesigned overview, search, architecture, settings and repositories scenes', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    expect(document.querySelector('h1')?.textContent).toBe('Codebase Overview')
    expect(document.body.textContent).toContain('repo-one')
    const scenes: Array<[string, string]> = [['Code Search', 'Find source evidence'], ['Architecture', 'Architecture Canvas'], ['Settings', 'Account & Workspace Settings'], ['Repositories', 'Repository Management']]
    for (const [label, heading] of scenes) {
      const button = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes(label)) as HTMLButtonElement
      await act(async () => { button.click() })
      expect(document.querySelector('h1')?.textContent).toBe(heading)
      expect(document.body.textContent).toContain('repo-one')
    }
  })

  it('persists the supported reduced-motion setting through the preferences API', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const button = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes('Settings')) as HTMLButtonElement
    await act(async () => { button.click(); await Promise.resolve() })
    const toggle = document.querySelector('input[role="switch"]') as HTMLInputElement
    await act(async () => { toggle.click(); await Promise.resolve() })
    const save = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Save Changes')) as HTMLButtonElement
    await act(async () => { save.click(); await Promise.resolve() })
    expect(api.request).toHaveBeenCalledWith('/users/me/preferences', expect.objectContaining({ method: 'PATCH' }))
  })

  it('applies compact density immediately from the settings preference', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const button = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes('Settings')) as HTMLButtonElement
    await act(async () => { button.click(); await Promise.resolve() })
    const toggle = document.querySelector('input[aria-label="Compact workspace density"]') as HTMLInputElement
    expect(toggle.closest('section')?.textContent).toContain('Interaction Preferences')
    await act(async () => { toggle.click(); await Promise.resolve() })
    expect(document.documentElement.dataset.compactMode).toBe('true')
  })

  it('shows a visible search error from the redesigned search workbench', async () => {
    vi.mocked(api.request).mockImplementation((url: string) => url.includes('/search') ? Promise.reject(new Error('Search service unavailable')) as never : defaultRequest(url) as never)
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const button = Array.from(document.querySelectorAll('nav button')).find(item => item.textContent?.includes('Code Search')) as HTMLButtonElement
    await act(async () => { button.click() })
    const input = document.querySelector('input[aria-label="Search source"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => { setter?.call(input, 'startup'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { document.querySelector('form.ex-search-bar')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(document.body.textContent).toContain('Search service unavailable')
    expect(document.body.textContent).toContain('Try again')
  })
})

describe('authentication flow', () => {
  let root: Root
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/')
    vi.mocked(api.me).mockResolvedValue({ authenticated: false, user: null })
    vi.mocked(api.register).mockResolvedValue({ registered: true, email: 'new@example.com' })
    root = createRoot(document.getElementById('root')!)
  })
  afterEach(() => { act(() => { root?.unmount() }) })
  it('keeps registration separate from login', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const switchButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Need an account')) as HTMLButtonElement
    await act(async () => { switchButton.click() })
    const email = document.querySelector('input[type="email"]') as HTMLInputElement
    const password = document.querySelector('input[type="password"]') as HTMLInputElement
    await act(async () => {
      const set = (element: HTMLInputElement, value: string) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) }
      set(email, 'new@example.com'); set(password, 'correct horse battery')
      document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve()
    })
    expect(api.register).toHaveBeenCalledWith('new@example.com', 'correct horse battery')
    expect(api.login).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/login')
    expect(document.body.textContent).toContain('Account created successfully')
  })
})
