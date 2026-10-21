import { useEffect, useState, type FormEvent } from 'react'
import * as api from './api'
import { ArchitectureScreen, RepositoriesScreen, SettingsScreen } from './ManagementScreens'
import { IssueScreen, OverviewScreen, SearchScreen } from './ExplorerScreens'
import { pathForRoute, routeForPath, type AppRoute, type RouteName } from './routing'

type WorkspaceRoute = Exclude<RouteName, 'landing' | 'login' | 'register' | 'not-found'>

function App() {
  const [route, setRoute] = useState<AppRoute>(() => routeForPath(window.location.pathname))
  const [user, setUser] = useState<api.AuthUser | null>(null)
  const [project, setProject] = useState<api.ImportResponse | null>(null)
  const [projects, setProjects] = useState<api.ImportResponse[]>([])
  const [authLoading, setAuthLoading] = useState(true)
  const [authUnavailable, setAuthUnavailable] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [compactMode, setCompactMode] = useState(false)

  const navigate = (name: WorkspaceRoute, replace = false) => {
    const path = pathForRoute(name)
    if (replace) window.history.replaceState({}, '', path)
    else window.history.pushState({}, '', path)
    setRoute(routeForPath(path))
  }

  const rememberProject = (next: api.ImportResponse) => {
    setProject(next)
    if (user) localStorage.setItem(`repopilot.last_project.${user.id}`, next.id)
  }

  const selectProject = async (id: string) => {
    const next = projects.find(item => item.id === id)
    if (!next) return
    rememberProject(next)
    navigate('overview', true)
  }

  const importCompleted = async (next: api.ImportResponse) => {
    try {
      await api.getTree(next.id)
      rememberProject(next)
      setProjects(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? next : item) : [next, ...current])
      navigate('overview', true)
    } catch (reason) {
      setWorkspaceError(reason instanceof Error ? reason.message : 'The repository was imported but could not be opened.')
    }
  }

  useEffect(() => {
    const onPopState = () => setRoute(routeForPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    void api.me().then(result => {
      setAuthUnavailable(false)
      setUser(result.authenticated ? result.user : null)
      if (!result.authenticated) setProject(null)
    }).catch(() => {
      setUser(null)
      setAuthUnavailable(true)
    }).finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    if (!user) return
    void api.listProjects().then(result => {
      setProjects(result.projects)
      const savedId = localStorage.getItem(`repopilot.last_project.${user.id}`)
      const restored = result.projects.find(item => item.id === savedId) || (result.projects.length === 1 ? result.projects[0] : undefined)
      if (restored) {
        rememberProject(restored)
        if (route.name === 'landing' || route.name === 'login' || route.name === 'register') navigate('overview', true)
      }
    }).catch(reason => setWorkspaceError(reason instanceof Error ? reason.message : 'Could not load repositories.'))
  }, [user])

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false'
    document.documentElement.dataset.compactMode = compactMode ? 'true' : 'false'
  }, [reducedMotion, compactMode])

  const clearWorkspace = () => {
    setProject(null)
    setProjects([])
    setWorkspaceError('')
    if (user) localStorage.removeItem(`repopilot.last_project.${user.id}`)
  }

  if (authLoading) return <div className="app min-h-screen"><Header project={null} user={null} /><main className="loading-screen"><div className="loader-orb">✦</div><p>Checking your session…</p></main></div>
  if (authUnavailable) return <Unavailable onRetry={() => window.location.reload()} />
  if (!user && route.name === 'not-found') return <NotFound title="Route not found" detail="Sign in to access RepoPilot, or return to the login page." navigate={() => { window.history.replaceState({}, '', '/login'); setRoute({ name: 'login' }) }} />
  if (!user) return <AuthLanding initialMode={route.name === 'register' ? 'register' : 'login'} onModeChange={mode => { window.history.pushState({}, '', `/${mode}`); setRoute(routeForPath(`/${mode}`)) }} onAuthenticated={next => { setAuthUnavailable(false); setUser(next); navigate('overview', true) }} />

  const logout = () => {
    void api.logout()
    clearWorkspace()
    setUser(null)
    window.history.replaceState({}, '', '/')
    setRoute({ name: 'landing' })
  }
  if (route.name === 'not-found') return <div className="app min-h-screen"><Header project={project} user={user} onLogout={logout} /><NotFound navigate={() => navigate('overview')} /></div>

  const deleted = (id: string) => {
    setProjects(current => current.filter(item => item.id !== id))
    if (project?.id === id) {
      setProject(null)
      navigate('repositories', true)
    }
  }
  const content = !project
    ? route.name === 'settings'
      ? <SettingsScreen user={user} project={null} onDeleted={deleted} onPreferencesChanged={prefs => { setReducedMotion(prefs.reduced_motion); setCompactMode(prefs.compact_mode) }} />
      : route.name === 'repositories'
        ? <RepositoriesScreen projects={projects} selectedId="" onSelect={selectProject} onImported={importCompleted} onDeleted={deleted} />
        : <NoProjectScene route={route.name} onOpenRepositories={() => navigate('repositories')} />
    : route.name === 'settings'
      ? <SettingsScreen user={user} project={project} onDeleted={deleted} onPreferencesChanged={prefs => { setReducedMotion(prefs.reduced_motion); setCompactMode(prefs.compact_mode) }} />
      : route.name === 'repositories'
        ? <RepositoriesScreen projects={projects} selectedId={project.id} onSelect={selectProject} onImported={importCompleted} onDeleted={deleted} />
        : route.name === 'architecture'
          ? <ArchitectureScreen project={project} />
          : route.name === 'search'
            ? <SearchScreen project={project} />
            : route.name === 'investigate'
              ? <IssueScreen project={project} />
              : <OverviewScreen project={project} onNavigate={navigate} onOpenFile={() => navigate('search')} />

  return <div className="app min-h-screen"><a className="skip-link" href="#main-content">Skip to main content</a><Header project={project} user={user} onLogout={logout} /><main className="shell"><Sidebar project={project} projects={projects} route={route} navigate={navigate} onSelectProject={selectProject} /><section id="main-content" className="content">{workspaceError && <Alert message={workspaceError} clear={() => setWorkspaceError('')} />}{content}</section></main></div>
}

function Header({ project, user, onLogout }: { project: api.ImportResponse | null; user: api.AuthUser | null; onLogout?: () => void }) {
  return <header><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="header-right"><span className="status-dot" aria-hidden="true" /><span className="session-label">{project ? project.repository_name : user ? 'No repository selected' : 'Signed out'}</span>{user && <><span className="user-email">{user.email}</span><button className="logout-button" onClick={onLogout}>Log out</button></>}</div></header>
}

function Unavailable({ onRetry }: { onRetry: () => void }) {
  return <div className="auth-page unavailable-page"><div className="auth-panel"><div className="auth-panel-inner"><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="eyebrow">WORKSPACE UNAVAILABLE</div><h2>Connect to the RepoPilot backend</h2><p className="auth-detail">The frontend could not reach the API. Start FastAPI on port 8000, then retry.</p><button className="primary auth-submit" onClick={onRetry}>Retry connection</button></div></div></div>
}

function AuthLanding({ initialMode, onModeChange, onAuthenticated }: { initialMode: 'login' | 'register'; onModeChange: (mode: 'login' | 'register') => void; onAuthenticated: (user: api.AuthUser) => void }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  useEffect(() => setMode(initialMode), [initialMode])
  const switchMode = (next: 'login' | 'register') => { setMode(next); setError(''); setSuccess(''); onModeChange(next) }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try {
      if (mode === 'login') onAuthenticated((await api.login(email.trim(), password)).user)
      else { const result = await api.register(email.trim(), password); if (!result.registered) throw new Error('Registration was not confirmed by the server'); setPassword(''); switchMode('login'); setSuccess('Account created successfully. Sign in to continue.') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication failed') }
    finally { setBusy(false) }
  }
  return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><div className="brand-mark">▣</div><div><b>RepoPilot</b><span>AI PLATFORM</span></div></div><span className="auth-version"><i /> RepoPilot AI · local workspace</span><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p className="auth-detail">{mode === 'login' ? 'Sign in to access your repositories and code insights.' : 'Start exploring codebases and understanding architectures.'}</p><div className="auth-provider-note">Email authentication is enabled for this workspace.</div><div className="auth-divider"><span>OR CONTINUE WITH EMAIL</span></div><form onSubmit={submit}><label>Email<input type="email" required autoComplete="email" placeholder="developer@company.internal" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 10 characters" value={password} onChange={event => setPassword(event.target.value)} /><small>Use 10–200 characters.</small></label>{success && <div className="auth-success" role="status">{success}</div>}{error && <div className="auth-error" role="alert">{error}</div>}<div className="auth-row"><label className="check-label"><input type="checkbox" /> Remember this device</label>{mode === 'login' && <span className="auth-help">Password reset is not configured.</span>}</div><button className="primary auth-submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in to RepoPilot →' : 'Create account →'}</button></form><button className="auth-switch" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button><div className="auth-footnote">Source is analyzed in a safe snapshot. Repository code is never executed.</div></div></div>
}

function Sidebar({ project, projects, route, navigate, onSelectProject }: { project: api.ImportResponse | null; projects: api.ImportResponse[]; route: AppRoute; navigate: (name: WorkspaceRoute) => void; onSelectProject: (id: string) => void }) {
  const links: Array<[WorkspaceRoute, string, string]> = [['overview', '▦', 'Overview'], ['search', '⌕', 'Code Search'], ['investigate', '◈', 'Issue Assistant'], ['architecture', '⌬', 'Architecture'], ['repositories', '▤', 'Repositories'], ['settings', '⚙', 'Settings']]
  return <aside><div className="side-top"><div className="brand side-brand"><div className="brand-mark">▣</div><div><b>RepoPilot</b><span>AI PLATFORM</span></div></div><div className="side-label">WORKSPACE</div><div className="workspace"><div className="repo-icon">⌁</div><div className="workspace-copy"><b>{project ? project.repository_name : 'Your workspace'}</b><small>{project ? project.source.url?.replace('https://github.com/', '') || project.source.filename : 'Import a codebase to begin'}</small></div></div>{projects.length > 1 && <label className="project-switcher">Switch repository<select aria-label="Switch repository" value={project?.id || ''} onChange={event => onSelectProject(event.target.value)}><option value="" disabled>Select repository</option>{projects.map(item => <option value={item.id} key={item.id}>{item.repository_name}</option>)}</select></label>}<nav>{links.map(([value, glyph, label]) => <button key={value} className={route.name === value ? 'active' : ''} aria-current={route.name === value ? 'page' : undefined} onClick={() => navigate(value)}><span className="ico" aria-hidden="true">{glyph}</span><span>{label}</span></button>)}</nav></div><div className="aside-foot"><div className="limit"><b>Context engine</b><span>{project ? 'Synced to selected snapshot' : 'Ready for your first repository'}</span><small>Deterministic · {project ? 'Ready' : 'Waiting'}</small></div><small>REPOPILOT AI · EVIDENCE FIRST</small></div></aside>
}

function Alert({ message, clear }: { message: string; clear: () => void }) {
  return <div className="alert" role="alert" aria-live="assertive"><span className="ico" aria-hidden="true">!</span><div><b>Something needs attention</b><span>{message}</span></div><button onClick={clear} aria-label="Dismiss error">×</button></div>
}

function NoProjectScene({ route, onOpenRepositories }: { route: string; onOpenRepositories: () => void }) {
  const scenes: Record<string, { title: string; detail: string }> = {
    search: { title: 'Find source evidence', detail: 'Import a repository snapshot first, then search its files, symbols, imports, and source lines.' },
    investigate: { title: 'Investigate an issue', detail: 'Import a repository snapshot first so issue findings can be grounded in source evidence.' },
    architecture: { title: 'Architecture Canvas', detail: 'Import a repository snapshot first to map its direct static import relationships.' },
    overview: { title: 'Codebase Overview', detail: 'Import a repository snapshot to see its structure, source statistics, and analysis coverage.' },
  }
  const scene = scenes[route] || scenes.overview
  return <div className="ex-empty-screen"><div className="ex-pill">Workspace scene</div><h1>{scene.title}</h1><p>{scene.detail}</p><button className="primary" onClick={onOpenRepositories}>Open Repository Management</button></div>
}

function NotFound({ navigate, title = 'Route not found', detail = 'Use the workspace navigation to continue.' }: { navigate: () => void; title?: string; detail?: string }) {
  return <main className="not-found"><div className="not-found-mark">404</div><div className="eyebrow">REPOPILOT ROUTER</div><h1>{title}</h1><p>{detail}</p><button className="primary" onClick={navigate}>Return to workspace</button></main>
}

export default App
