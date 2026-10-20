import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import * as api from './api'
import { pathForRoute, routeForPath, type AppRoute, type RouteName } from './routing'
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

type Tab = 'overview' | 'search' | 'investigate' | 'architecture' | 'repositories' | 'settings'
type PageMeta = { eyebrow: string; title: string; description: string }

const pageMeta: Record<Tab, PageMeta> = {
  overview: { eyebrow: 'PROJECT OVERVIEW', title: 'Understand your codebase.', description: 'Review computed repository facts, browse source files, and follow evidence into the code.' },
  search: { eyebrow: 'CODE SEARCH', title: 'Find exact source evidence.', description: 'Search the indexed snapshot by path, symbol, import, or source text.' },
  investigate: { eyebrow: 'ISSUE INVESTIGATION', title: 'Turn a question into evidence.', description: 'Combine a focused question with optional runtime context and inspect the static findings.' },
  architecture: { eyebrow: 'ARCHITECTURE', title: 'See the import relationships.', description: 'Explore direct relationships extracted from the repository snapshot.' },
  repositories: { eyebrow: 'REPOSITORIES', title: 'Manage indexed codebases.', description: 'Import a public GitHub repository or a local archive into this workspace.' },
  settings: { eyebrow: 'WORKSPACE SETTINGS', title: 'Control this workspace.', description: 'Manage the signed-in session, repository data, and supported interface preferences.' },
}

const icon = (value: string) => <span className="ico" aria-hidden="true">{value}</span>

function App() {
  const [project, setProject] = useState<api.ImportResponse | null>(null)
  const [projects, setProjects] = useState<api.ImportResponse[]>([])
  const [tree, setTree] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')
  const [route, setRoute] = useState<AppRoute>(() => routeForPath(window.location.pathname))
  const [url, setUrl] = useState('')
  const [query, setQuery] = useState('')
  const [question, setQuestion] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [stackTrace, setStackTrace] = useState('')
  const [results, setResults] = useState<api.SearchResult[]>([])
  const [lastSearchQuery, setLastSearchQuery] = useState('')
  const [investigation, setInvestigation] = useState<api.Investigation | null>(null)
  const [graphData, setGraphData] = useState<api.Graph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [user, setUser] = useState<api.AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authUnavailable, setAuthUnavailable] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null)
  const retryRef = useRef<(() => void) | null>(null)

  const tab: Tab = route.name === 'search' || route.name === 'investigate' || route.name === 'architecture' || route.name === 'repositories' || route.name === 'settings' ? route.name : 'overview'
  const navigate = (name: Exclude<RouteName, 'landing' | 'not-found'>, replace = false) => {
    const path = pathForRoute(name)
    if (replace) window.history.replaceState({}, '', path); else window.history.pushState({}, '', path)
    setRoute(routeForPath(path))
  }

  const clearSessionCache = () => { sessionStorage.removeItem('repopilot.project') }

  useEffect(() => {
    void api.me().then(async result => {
      setAuthUnavailable(false)
      setUser(result.user)
      clearSessionCache()
      if (!result.authenticated || !result.user) {
        clearWorkspace()
        return
      }
      const savedId = localStorage.getItem(`repopilot.last_project.${result.user.id}`)
      const availableProjects = (await api.listProjects()).projects
      setProjects(availableProjects)
      const restored = availableProjects.find(item => item.id === savedId) || (availableProjects.length === 1 ? availableProjects[0] : undefined)
      if (restored) {
        setProject(restored)
        setTree(restored.analysis.files.map(file => file.path))
      }
      const savedSettings = localStorage.getItem(`repopilot.settings.${result.user.id}`)
      if (savedSettings) {
        try { setReducedMotion(Boolean((JSON.parse(savedSettings) as { reducedMotion?: unknown }).reducedMotion)) } catch { setReducedMotion(false) }
      }
      if (route.name === 'landing' || route.name === 'login' || route.name === 'register') {
        window.history.replaceState({}, '', '/workspace')
        setRoute({ name: 'overview' })
      }
    }).catch(() => {
      setUser(null)
      setAuthUnavailable(true)
    }).finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false'
    if (user) localStorage.setItem(`repopilot.settings.${user.id}`, JSON.stringify({ reducedMotion }))
  }, [reducedMotion, user])

  useEffect(() => {
    const onPopState = () => setRoute(routeForPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (project && (route.name === 'landing' || route.name === 'login' || route.name === 'register')) navigate('overview', true)
  }, [project, route.name])

  useEffect(() => {
    if (project && route.name === 'architecture' && !graphData && !loading) void loadGraph()
  }, [project, route.name, graphData, loading])

  const clearWorkspace = () => {
    sessionStorage.removeItem('repopilot.project')
    setProject(null)
    setTree([])
    setSelected('')
    setContent('')
    setGraphData(null)
    setLastSearchQuery('')
    setResults([])
  }

  const run = async (task: () => Promise<void>, retry?: () => void) => {
    setLoading(true); setError(''); setRetryAction(null); retryRef.current = null
    try { await task() } catch (reason) {
      const status = reason instanceof Error ? (reason as Error & { status?: number }).status : undefined
      if (status === 401) { clearWorkspace(); setUser(null); window.history.replaceState({}, '', '/'); setRoute({ name: 'landing' }); setError('Your session expired. Please sign in again.') }
      else if (status === 404) { clearWorkspace(); navigate('overview', true); setError('That project is no longer available. Import it again.') }
      else {
        const nextRetry = retry || null
        retryRef.current = nextRetry
        setRetryAction(() => nextRetry)
        setError(reason instanceof Error ? reason.message : 'Something went wrong')
      }
    } finally { setLoading(false) }
  }

  const loadProject = async (imported: api.ImportResponse) => {
    const response = await api.getTree(imported.id)
    setProject(imported)
    setTree(response.files)
    if (user) localStorage.setItem(`repopilot.last_project.${user.id}`, imported.id)
    navigate('overview', true)
    setSelected('')
    setContent('')
    setResults([])
    setLastSearchQuery('')
    setInvestigation(null)
    setGraphData(null)
    setProjects(current => current.some(item => item.id === imported.id) ? current.map(item => item.id === imported.id ? imported : item) : [imported, ...current])
  }

  const loadExistingProject = (id: string) => {
    const existing = projects.find(item => item.id === id)
    if (!existing) return
    void run(async () => loadProject(existing), () => loadExistingProject(id))
  }

  const submitUrl = () => {
    const value = url.trim()
    if (loading) return
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(?:\.git)?\/?$/.test(value)) {
      setError('Enter a valid public GitHub repository URL, for example https://github.com/owner/repository.')
      return
    }
    void run(async () => loadProject(await api.importGithub(value)), submitUrl)
  }
  const importArchiveFile = (file: File) => void run(async () => loadProject(await api.importArchive(file)), () => importArchiveFile(file))
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    if (loading) return
    const file = event.target.files?.[0]
    if (!file) return
    const allowed = /\.(zip|tar|tar\.gz|tgz)$/i.test(file.name)
    if (!allowed) { setError('Choose a ZIP, TAR, TAR.GZ, or TGZ archive.'); event.target.value = ''; return }
    if (file.size > 25 * 1024 * 1024) { setError('The archive must be 25 MB or smaller.'); event.target.value = ''; return }
    importArchiveFile(file)
  }

  useEffect(() => {
    const filePath = route.filePath || selected
    if (!project || !filePath) return
    if (route.filePath && route.filePath !== selected) setSelected(route.filePath)
    void run(async () => setContent((await api.getFile(project.id, filePath)).content))
  }, [project, selected, route.filePath])

  const doSearch = () => {
    if (!project) return
    if (!query.trim()) { setError('Enter a search term before searching.'); return }
    const requestedQuery = query.trim()
    void run(async () => { setResults(await api.search(project.id, requestedQuery)); setLastSearchQuery(requestedQuery); navigate('search') }, doSearch)
  }
  const clearSearch = () => { setQuery(''); setResults([]); setLastSearchQuery('') }
  const doInvestigation = () => {
    if (!project) return
    if (!question.trim()) { setError('Describe the issue or investigation question first.'); return }
    const requestedQuestion = question.trim()
    void run(async () => { setInvestigation(await api.investigate(project.id, { question: requestedQuestion, error_message: errorMessage.trim(), stack_trace: stackTrace })); navigate('investigate') }, doInvestigation)
  }
  const loadGraph = () => project && run(async () => { setGraphData(await api.graph(project.id)); navigate('architecture') }, loadGraph)
  const downloadReport = () => project && run(async () => { const { markdown } = await api.report(project.id, { question: question.trim(), error_message: errorMessage.trim(), stack_trace: stackTrace }); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' })); link.download = `${project.repository_name}-report.md`; link.click(); URL.revokeObjectURL(link.href) }, downloadReport)
  const openFile = (path: string) => { setSelected(path); window.history.pushState({}, '', `/file/${encodeURIComponent(path)}`); setRoute({ name: 'overview', filePath: path }) }

  if (authLoading) return <div className="app min-h-screen"><Header project={null} user={null} /><main className="loading-screen"><div className="loader-orb">✦</div><p>Checking your session…</p></main></div>
  if (authUnavailable) return <Unavailable onRetry={() => window.location.reload()} />
  if (!user && route.name === 'not-found') return <NotFound title="Route not found" detail="Sign in to access RepoPilot, or return to the login page." navigate={() => { window.history.replaceState({}, '', '/login'); setRoute({ name: 'login' }) }} />
  if (!user) return <AuthLanding
    initialMode={route.name === 'register' ? 'register' : 'login'}
    onModeChange={(mode) => { window.history.pushState({}, '', `/${mode}`); setRoute(routeForPath(`/${mode}`)) }}
    onAuthenticated={(nextUser) => { setAuthUnavailable(false); setUser(nextUser); if (route.name === 'landing' || route.name === 'login' || route.name === 'register') navigate('overview', true) }}
  />
  const logout = () => { void api.logout(); clearWorkspace(); clearSessionCache(); setProjects([]); setUser(null); window.history.replaceState({}, '', '/'); setRoute({ name: 'landing' }) }
  if (route.name === 'not-found') return <div className="app min-h-screen"><Header project={project} user={user} onLogout={logout} /><NotFound navigate={() => navigate('overview')} /></div>
  if (!project) return <div className="app min-h-screen"><a className="skip-link" href="#main-content">Skip to main content</a><Header project={null} user={user} onLogout={logout} /><main className="shell"><Sidebar project={null} projects={projects} route={route} navigate={navigate} loadGraph={() => navigate('architecture')} onSelectProject={() => undefined} /><section id="main-content" className="content">{error && <Alert message={error} clear={() => setError('')} onRetry={retryAction || undefined} />}{route.name === 'repositories' ? <><PageHeader meta={pageMeta.repositories} breadcrumbs={[]} /><RepositoriesPage projects={projects} selectedId="" onSelectProject={() => undefined} url={url} setUrl={setUrl} submitUrl={submitUrl} upload={upload} loading={loading} /></> : <EmptyRouteContent route={route} url={url} setUrl={setUrl} submitUrl={submitUrl} upload={upload} loading={loading} navigate={navigate} />}</section></main></div>
  return <div className="app min-h-screen">
    <a className="skip-link" href="#main-content">Skip to main content</a>
     <Header project={project} user={user} onLogout={logout} />
     <main className="shell">
       <Sidebar project={project} projects={projects} route={route} navigate={navigate} loadGraph={loadGraph} onSelectProject={loadExistingProject} />
       <section id="main-content" className="content">
         <PageHeader meta={pageMeta[tab]} breadcrumbs={project ? [project.repository_name] : []} action={project ? <button className="outline" onClick={downloadReport}>{icon('↓')} Download report</button> : undefined} />
         {error && <Alert message={error} clear={() => { setError(''); setRetryAction(null); retryRef.current = null }} onRetry={retryAction || undefined} />}
         {route.name === 'settings' ? <SettingsPage project={project} user={user} reducedMotion={reducedMotion} setReducedMotion={setReducedMotion} onDeleted={() => { clearWorkspace(); setProjects(current => current.filter(item => item.id !== project.id)); navigate('overview', true) }} /> : route.name === 'repositories' ? <RepositoriesPage projects={projects} selectedId={project.id} onSelectProject={loadExistingProject} url={url} setUrl={setUrl} submitUrl={submitUrl} upload={upload} loading={loading} /> : <Workspace project={project} tree={tree} selected={route.filePath || selected} setSelected={openFile} content={content} tab={tab} navigate={navigate} loading={loading} query={query} setQuery={setQuery} doSearch={doSearch} clearSearch={clearSearch} results={results} lastSearchQuery={lastSearchQuery} question={question} setQuestion={setQuestion} errorMessage={errorMessage} setErrorMessage={setErrorMessage} stackTrace={stackTrace} setStackTrace={setStackTrace} doInvestigation={doInvestigation} investigation={investigation} graphData={graphData} openFile={openFile} />}
       </section>
    </main>
  </div>
}

function Header({ project, user, onLogout }: { project: api.ImportResponse | null; user: api.AuthUser | null; onLogout?: () => void }) { return <header><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="header-right"><span className="status-dot" aria-hidden="true" /> <span className="session-label">{project ? project.repository_name : user ? 'No repository selected' : 'Signed out'}</span> {user && <><span className="user-email">{user.email}</span><button className="logout-button" onClick={onLogout}>Log out</button></>}</div></header> }

function PageHeader({ meta, breadcrumbs, action }: { meta: PageMeta; breadcrumbs: string[]; action?: ReactNode }) { return <div className="topline"><div><div className="breadcrumbs" aria-label="Breadcrumb"><span>Workspace</span>{breadcrumbs.map(item => <span key={item}> / {item}</span>)}</div><div className="eyebrow">{meta.eyebrow}</div><h1>{meta.title}</h1><p className="subtitle">{meta.description}</p></div>{action}</div> }

function LandingCopy() { return <div className="landing-copy"><div className="eyebrow">CODE INTELLIGENCE WORKSPACE</div><h2>Understand every layer of your repository.</h2><p>Import a public codebase, trace evidence, and investigate issues without executing untrusted source.</p><div className="landing-points"><span>✦ Evidence-backed findings</span><span>⌁ Direct import relationships</span><span>◈ Private workspace session</span></div></div> }

function Unavailable({ onRetry }: { onRetry: () => void }) { return <div className="auth-page unavailable-page"><div className="auth-panel"><div className="auth-panel-inner"><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="eyebrow">WORKSPACE UNAVAILABLE</div><h2>Connect to the RepoPilot backend</h2><p className="auth-detail">The frontend could not reach the API. Start FastAPI on port 8000, then retry.</p><button className="primary auth-submit" onClick={onRetry}>Retry connection</button></div></div></div> }

function AuthLanding({ initialMode, onModeChange, onAuthenticated }: { initialMode: 'login' | 'register'; onModeChange: (mode: 'login' | 'register') => void; onAuthenticated: (user: api.AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
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
      if (mode === 'login') {
        const result = await api.login(email.trim(), password)
        onAuthenticated(result.user)
      } else {
        const result = await api.register(email.trim(), password)
        if (!result.registered) throw new Error('Registration was not confirmed by the server')
        setPassword(''); setMode('login'); onModeChange('login'); setSuccess('Account created successfully. Sign in to continue.')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication failed') }
    finally { setBusy(false) }
  }
  return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><div className="brand-mark">▣</div><div><b>RepoPilot</b><span>AI PLATFORM</span></div></div><span className="auth-version"><i /> RepoPilot AI · local workspace</span><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p className="auth-detail">{mode === 'login' ? 'Sign in to access your repositories and code insights.' : 'Start exploring codebases and understanding architectures.'}</p><div className="auth-provider-note">Email authentication is enabled for this workspace.</div><div className="auth-divider"><span>OR CONTINUE WITH EMAIL</span></div><form onSubmit={submit}><label>Email<input type="email" required autoComplete="email" placeholder="developer@company.internal" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 10 characters" value={password} onChange={event => setPassword(event.target.value)} /><small>Use 10–200 characters.</small></label>{success && <div className="auth-success" role="status">{success}</div>}{error && <div className="auth-error" role="alert">{error}</div>}<div className="auth-row"><label className="check-label"><input type="checkbox" /> Remember this device</label>{mode === 'login' && <span className="auth-help">Password reset is not configured.</span>}</div><button className="primary auth-submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in to RepoPilot →' : 'Create account →'}</button></form><button className="auth-switch" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button><div className="auth-footnote">Source is analyzed in a safe snapshot. Repository code is never executed.</div></div></div>
}
function Sidebar({ project, projects, route, navigate, loadGraph, onSelectProject }: { project: api.ImportResponse | null; projects: api.ImportResponse[]; route: AppRoute; navigate: (name: Exclude<RouteName, 'landing' | 'not-found'>) => void; loadGraph: () => void; onSelectProject: (id: string) => void }) { const links: Array<[Exclude<RouteName, 'landing' | 'not-found'>, string, string]> = [['overview', '▦', 'Overview'], ['search', '⌕', 'Code Search'], ['investigate', '◈', 'Issue Assistant'], ['architecture', '⌬', 'Architecture'], ['repositories', '▤', 'Repositories'], ['settings', '⚙', 'Settings']]; return <aside><div className="side-top"><div className="brand side-brand"><div className="brand-mark">▣</div><div><b>RepoPilot</b><span>AI PLATFORM</span></div></div><div className="side-label">WORKSPACE</div><div className="workspace"><div className="repo-icon">⌁</div><div className="workspace-copy"><b>{project ? project.repository_name : 'Your workspace'}</b><small>{project ? project.source.url?.replace('https://github.com/', '') || project.source.filename : 'Import a codebase to begin'}</small></div></div>{projects.length > 1 && <label className="project-switcher">Switch repository<select aria-label="Switch repository" value={project?.id || ''} onChange={event => onSelectProject(event.target.value)}><option value="" disabled>Select repository</option>{projects.map(item => <option value={item.id} key={item.id}>{item.repository_name}</option>)}</select></label>}<nav>{links.map(([value, glyph, label]) => <button key={value} className={route.name === value || (value === 'overview' && route.name === 'landing') ? 'active' : ''} aria-current={route.name === value || (value === 'overview' && route.name === 'landing') ? 'page' : undefined} onClick={() => value === 'architecture' && project ? loadGraph() : navigate(value)}>{icon(glyph)} <span>{label}</span>{value === 'search' && <span className="sr-only">Code search</span>}{value === 'investigate' && <span className="sr-only">Investigate issue</span>}</button>)}</nav></div><div className="aside-foot"><div className="limit"><b>Context engine</b><span>{project ? 'Synced to selected snapshot' : 'Ready for your first repository'}</span><small>Deterministic · {project ? 'Ready' : 'Waiting'}</small></div><small>REPOPILOT AI · EVIDENCE FIRST</small></div></aside> }

function Alert({ message, clear, onRetry }: { message: string; clear: () => void; onRetry?: () => void }) { return <div className="alert" role="alert" aria-live="assertive">{icon('!')}<div><b>Something needs attention</b><span>{message}</span></div>{onRetry && <button className="retry-button" onClick={onRetry}>Retry</button>}<button onClick={clear} aria-label="Dismiss error">×</button></div> }

function RepositoriesPage({ projects, selectedId, onSelectProject, url, setUrl, submitUrl, upload, loading }: { projects: api.ImportResponse[]; selectedId: string; onSelectProject: (id: string) => void; url: string; setUrl: (value: string) => void; submitUrl: () => void; upload: (event: ChangeEvent<HTMLInputElement>) => void; loading: boolean }) {
  const totals = projects.reduce((sum, item) => ({ files: sum.files + item.file_count, symbols: sum.symbols + item.symbol_count, imports: sum.imports + item.import_count }), { files: 0, symbols: 0, imports: 0 })
  return <div className="repositories-page"><div className="repo-import-grid"><Card className="repo-connect-card"><div className="repo-card-heading"><span className="feature-icon blue">⌘</span><div><h2>Connect a remote provider</h2><p>Import a public GitHub repository. RepoPilot analyzes a safe snapshot without executing repository code.</p></div><span className="badge info">GitHub</span></div><label className="field-label" htmlFor="repo-url">Repository URL</label><div className="repo-url-row"><input id="repo-url" aria-label="GitHub repository URL" placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => event.key === 'Enter' && submitUrl()} /><button className="primary" onClick={submitUrl} disabled={loading || !url.trim()}>{loading ? 'Indexing…' : 'Import repository'} <span>→</span></button></div><div className="repo-card-foot"><span>{icon('✓')} Public GitHub only</span><span>{icon('⌁')} Deterministic analysis</span></div></Card><Card className="repo-upload-card"><div className="repo-card-heading"><span className="feature-icon blue">⌑</span><div><h2>Upload local source</h2><p>Drop a ZIP, TAR, TAR.GZ, or TGZ archive directly.</p></div><span className="badge neutral">Local</span></div><label className="upload-zone"><input type="file" accept=".zip,.tar,.tar.gz,.tgz" onChange={upload} /><span className="upload-icon large">↥</span><b>{loading ? 'Analyzing archive…' : 'Choose an archive'}</b><small>Up to 25 MB compressed</small><span className="button-secondary">Browse files</span></label></Card></div><div className="repo-metrics"><Metric value={String(totals.files)} label="Files indexed" /><Metric value={String(totals.symbols)} label="Symbols found" /><Metric value={String(totals.imports)} label="Import edges" /><Metric value={String(projects.length)} label="Repositories" /></div><div className="repo-list-heading"><div><div className="eyebrow">INDEXED REPOSITORIES</div><h2>Your repositories <span className="badge success">{projects.length}</span></h2></div><span className="repo-list-note">Select a repository to make it active.</span></div>{projects.length ? <div className="repository-grid">{projects.map(item => <Card className={`repository-card ${item.id === selectedId ? 'selected-repository' : ''}`} key={item.id}><div className="repository-card-top"><span className="repo-tile">{item.repository_name.slice(0, 1).toUpperCase()}</span><span className="badge success">{item.id === selectedId ? 'Active' : 'Ready'}</span></div><h3>{item.repository_name}</h3><p className="repo-source">{item.source.url || item.source.filename || 'Imported archive'}</p><div className="repo-card-stats"><span><b>{item.file_count}</b> files</span><span><b>{item.symbol_count}</b> symbols</span><span><b>{item.import_count}</b> edges</span></div><div className="repository-actions"><button className="primary small" onClick={() => onSelectProject(item.id)} disabled={item.id === selectedId}>{item.id === selectedId ? 'Selected' : 'Open repository'}</button><span className="badge neutral">{Object.keys(item.analysis.languages || item.languages).join(' · ') || 'No language data'}</span></div></Card>)}</div> : <Card className="empty-repositories"><div className="feature-icon blue">⌁</div><h2>No repositories indexed yet</h2><p>Import a public GitHub repository or upload a safe archive to begin exploring real source evidence.</p></Card>}</div>
}

function EmptyRouteContent({ route, url, setUrl, submitUrl, upload, loading, navigate }: { route: AppRoute; url: string; setUrl: (value: string) => void; submitUrl: () => void; upload: (event: ChangeEvent<HTMLInputElement>) => void; loading: boolean; navigate: (name: Exclude<RouteName, 'landing' | 'not-found'>) => void }) {
  if (route.name === 'landing' || route.name === 'overview') return <><div className="topline"><div><div className="eyebrow">GET STARTED</div><h1>Bring a repository into focus.</h1><p className="subtitle">Import a codebase to unlock search, investigation, and architecture analysis.</p></div></div><LandingCopy /><ImportCard url={url} setUrl={setUrl} submitUrl={submitUrl} upload={upload} loading={loading} /></>
  const content: Record<string, { title: string; detail: string }> = {
    search: { title: 'Code search', detail: 'Import a repository first, then search symbols, paths, imports, and source lines.' },
    investigate: { title: 'Investigate an issue', detail: 'Import a repository first so findings can be grounded in source evidence.' },
    architecture: { title: 'Architecture map', detail: 'Import a repository first to generate an evidence-backed import graph.' },
    settings: { title: 'Settings', detail: 'Account and repository controls become available after a project is selected.' },
  }
  const page = content[route.name] || content.search
  return <Card className="tool empty-route"><div className="tool-symbol">{route.name === 'settings' ? '⚙' : '⌁'}</div><h2>{page.title}</h2><p>{page.detail}</p><button className="primary" onClick={() => navigate('overview')}>Import a repository</button></Card>
}

function ImportCard({ url, setUrl, submitUrl, upload, loading }: { url: string; setUrl: (value: string) => void; submitUrl: () => void; upload: (event: ChangeEvent<HTMLInputElement>) => void; loading: boolean }) { return <div className="import-grid"><div className="card import-main"><div className="card-icon">⌘</div><h2>Import from GitHub</h2><p>Paste a public repository URL. The backend validates, downloads, and analyzes a safe snapshot.</p><div className="url-row"><input aria-label="GitHub repository URL" placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => event.key === 'Enter' && submitUrl()} /><button onClick={submitUrl} disabled={loading || !url.trim()}>{loading ? 'Analyzing…' : 'Import repository'} <span>→</span></button></div><div className="hint">{icon('i')} Public GitHub repositories only · no Git history</div></div><label className="card dropzone"><div className="upload-icon">↥</div><h2>Upload an archive</h2><p>ZIP, TAR, or TAR.GZ · securely inspected in memory</p><span className="button-secondary">Choose file</span><input type="file" accept=".zip,.tar,.tar.gz,.tgz" onChange={upload} /></label><div className="trust"><span>✦</span><b>Grounded by evidence</b><small>Imported code is never executed. Unsupported files are flagged instead of guessed.</small></div></div> }

 function Workspace({ project, tree, selected, setSelected, content, tab, navigate, loading, query, setQuery, doSearch, clearSearch, results, lastSearchQuery, question, setQuestion, errorMessage, setErrorMessage, stackTrace, setStackTrace, doInvestigation, investigation, graphData, openFile }: { project: api.ImportResponse; tree: string[]; selected: string; setSelected: (path: string) => void; content: string; tab: Tab; navigate: (name: Exclude<RouteName, 'landing' | 'not-found'>) => void; loading: boolean; query: string; setQuery: (value: string) => void; doSearch: () => void; clearSearch: () => void; results: api.SearchResult[]; lastSearchQuery: string; question: string; setQuestion: (value: string) => void; errorMessage: string; setErrorMessage: (value: string) => void; stackTrace: string; setStackTrace: (value: string) => void; doInvestigation: () => void; investigation: api.Investigation | null; graphData: api.Graph | null; openFile: (path: string) => void }) { return <><div className="tabs" role="tablist" aria-label="Repository tools">{(['overview', 'search', 'investigate', 'architecture'] as Tab[]).map(value => <button role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => navigate(value === 'overview' ? 'overview' : value)} key={value}>{value === 'overview' ? 'Project status' : value[0].toUpperCase() + value.slice(1)}</button>)}</div>{tab === 'overview' && <Overview project={project} tree={tree} selected={selected} setSelected={setSelected} loading={loading} />}{tab === 'search' && <Search query={query} setQuery={setQuery} submit={doSearch} clear={clearSearch} results={results} lastSearchQuery={lastSearchQuery} select={openFile} loading={loading} />}{tab === 'investigate' && <><InvestigationContext errorMessage={errorMessage} setErrorMessage={setErrorMessage} stackTrace={stackTrace} setStackTrace={setStackTrace} /><Investigate question={question} setQuestion={setQuestion} submit={doInvestigation} data={investigation} loading={loading} openFile={openFile} /></>}{tab === 'architecture' && <Architecture data={graphData} loading={loading} selectFile={openFile} />}{tab === 'overview' && selected && <FilePreview path={selected} content={content} loading={loading} />}</> }

function SettingsPage({ project, user, reducedMotion, setReducedMotion, onDeleted }: { project: api.ImportResponse; user: api.AuthUser | null; reducedMotion: boolean; setReducedMotion: (value: boolean) => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const deleteCurrentProject = async () => {
    if (!window.confirm(`Delete ${project.repository_name}? This removes the stored analysis.`)) return
    setBusy(true); setMessage('')
     try { await api.deleteProject(project.id); if (user) localStorage.removeItem(`repopilot.last_project.${user.id}`); onDeleted() }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not delete the project') }
    finally { setBusy(false) }
  }
  return <div className="settings-grid"><Card className="settings-card"><div className="eyebrow">ACCOUNT</div><h2>Workspace account</h2><p>{user?.email || 'Signed-in account'}</p><div className="setting-row"><span>Authentication</span><b>Signed in</b></div><div className="setting-row"><span>Analysis mode</span><b>Deterministic · no model API</b></div></Card><Card className="settings-card"><div className="eyebrow">APPEARANCE</div><h2>Interface preferences</h2><p>Preferences are stored locally in this browser for this account. The dark developer-tool theme is the supported theme.</p><label className="setting-toggle"><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)} /><span><b>Reduce motion</b><small>Disable non-essential motion and transitions.</small></span></label></Card><Card className="settings-card danger-card"><div className="eyebrow">DATA LIFECYCLE</div><h2>Repository privacy</h2><p>Imported source is analyzed without executing repository code. Delete this project when you no longer need its stored snapshot.</p><button className="danger-button" onClick={deleteCurrentProject} disabled={busy}>{busy ? 'Deleting…' : 'Delete current project'}</button>{message && <div className="auth-error" role="alert">{message}</div>}</Card></div> }

function NotFound({ navigate, title = 'Route not found', detail = 'Use the workspace navigation to continue.' }: { navigate: () => void; title?: string; detail?: string }) { return <main className="not-found"><div className="not-found-mark">404</div><div className="eyebrow">REPOPILOT ROUTER</div><h1>{title}</h1><p>{detail}</p><button className="primary" onClick={navigate}>Return to workspace</button></main> }

function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`card ${className}`}>{children}</div> }
function InvestigationContext({ errorMessage, setErrorMessage, stackTrace, setStackTrace }: { errorMessage: string; setErrorMessage: (value: string) => void; stackTrace: string; setStackTrace: (value: string) => void }) { return <Card className="investigation-context"><div className="eyebrow">OPTIONAL RUNTIME CONTEXT</div><p>These fields are sent to the backend as evidence inputs; a stack-trace location does not prove a root cause.</p><input className="investigation-input" aria-label="Error message" placeholder="Error message (optional)" value={errorMessage} onChange={event => setErrorMessage(event.target.value)} /><textarea className="stack-input" aria-label="Stack trace" placeholder="Stack trace (optional)" value={stackTrace} onChange={event => setStackTrace(event.target.value)} /></Card> }
function Overview({ project, tree, selected, setSelected, loading }: { project: api.ImportResponse; tree: string[]; selected: string; setSelected: (path: string) => void; loading: boolean }) { const languages = Object.entries(project.analysis.languages || project.languages); const warnings = [...project.warnings, ...project.analysis.errors.map(item => ({ path: item.path, reason: item.reason }))]; const analyzedFiles = project.analysis.files.filter(file => file.status === 'analyzed').length; return <div className="overview-grid"><Card className="status-card"><div className="card-head"><div><div className="eyebrow">PROJECT STATUS</div><h2>{project.repository_name}</h2><p className="source-detail">{project.source.url || project.source.filename || 'Imported repository snapshot'}</p></div><span className="pill green">{loading ? 'Syncing…' : 'Indexed'}</span></div><div className="metrics"><Metric value={String(project.file_count)} label="Files indexed" /><Metric value={String(project.symbol_count)} label="Symbols found" /><Metric value={String(project.import_count)} label="Import edges" /></div>{languages.length > 0 && <div className="language-row"><span className="eyebrow">LANGUAGES</span>{languages.map(([language, count]) => <span className="language-pill" key={language}>{language} <b>{count}</b></span>)}</div>}<div className="notice"><span>✓</span><div><b>Analysis is grounded in the imported snapshot</b><small>{analyzedFiles} of {project.analysis.files.length} analyzed files have parser results. Unsupported or invalid files remain visible with their limitation.</small></div></div>{warnings.length > 0 && <div className="warning-list"><div className="eyebrow">ANALYSIS WARNINGS · {warnings.length}</div>{warnings.map((warning, index) => <div key={`${warning.path}-${index}`}><code>{warning.path}</code><span>{warning.reason}</span></div>)}</div>}</Card><Card className="tree"><div className="card-head"><div><div className="eyebrow">FILE EXPLORER</div><h2>Browse source</h2></div><span className="count">{tree.length} files</span></div>{tree.length ? tree.map(path => <button className={selected === path ? 'file selected-file' : 'file'} onClick={() => setSelected(path)} key={path}>{icon(path.split('/').length > 1 ? '·' : '›')}<span>{path}</span></button>) : <div className="empty">No files were returned by the importer.</div>}</Card></div> }
function Metric({ value, label }: { value: string; label: string }) { return <div><b>{value}</b><span>{label}</span></div> }
export function highlightMatches(text: string, query: string): ReactNode {
  const needle = query.trim()
  if (!needle) return text
  const parts: ReactNode[] = []
  let cursor = 0
  const lowerText = text.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  let match = lowerText.indexOf(lowerNeedle, cursor)
  while (match !== -1) {
    if (match > cursor) parts.push(text.slice(cursor, match))
    parts.push(<mark key={`${match}-${needle}`}>{text.slice(match, match + needle.length)}</mark>)
    cursor = match + needle.length
    match = lowerText.indexOf(lowerNeedle, cursor)
  }
  if (!parts.length) return text
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function Search({ query, setQuery, submit, clear, results, lastSearchQuery, select, loading }: { query: string; setQuery: (value: string) => void; submit: () => void; clear: () => void; results: api.SearchResult[]; lastSearchQuery: string; select: (path: string) => void; loading: boolean }) {
  const trimmedQuery = query.trim()
  const hasSearched = Boolean(lastSearchQuery)
  const message = loading ? 'Scanning indexed files…' : !hasSearched ? 'Search is limited to this repository’s indexed snapshot.' : 'No matching evidence was found.'
  return <Card className="tool"><ToolHeading glyph="⌕" title="Search the codebase" detail="Find exact evidence across indexed file contents, paths, symbols, and imports." /><div className="search-row"><label className="sr-only" htmlFor="search-query">Search indexed source</label><input id="search-query" aria-label="Search query" placeholder="Search for a symbol, error, or phrase…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && submit()} /><button onClick={submit} disabled={loading || !trimmedQuery}>{loading ? 'Searching…' : 'Search'}</button>{(query || results.length > 0) && <button className="outline" onClick={clear} disabled={loading}>Clear</button>}</div>{results.length > 0 && hasSearched ? <div className="search-summary" role="status">{results.length} result{results.length === 1 ? '' : 's'} for <b>{lastSearchQuery}</b></div> : <div className="empty">{message}</div>}{results.length > 0 && hasSearched && <div className="result-list">{results.map((result, index) => <button className="result" key={`${result.path}-${result.line}-${index}`} onClick={() => select(result.path)}><div className="result-meta"><span className="result-kind">{result.kind}</span>{result.language && <span>{result.language}</span>}<b>{result.path}</b><span>line {result.line}</span></div><code>{highlightMatches(result.text, lastSearchQuery)}</code></button>)}</div>}</Card>
}
 function InvestigationList({ title, items, className = '' }: { title: string; items: string[]; className?: string }) { return <section className={`investigation-section ${className}`}><div className="section-label">{title} <span>{items.length}</span></div>{items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <div className="empty compact">None reported.</div>}</section> }
function Investigate({ question, setQuestion, submit, data, loading, openFile }: { question: string; setQuestion: (value: string) => void; submit: () => void; data: api.Investigation | null; loading: boolean; openFile: (path: string) => void }) { return <Card className="tool"><ToolHeading glyph="◈" title="Investigate an issue" detail="Ask a focused question and review grounded findings." /><textarea aria-label="Investigation question" placeholder="e.g. Why does authentication fail on startup?" value={question} onChange={event => setQuestion(event.target.value)} /><button className="primary full" onClick={submit} disabled={loading || !question.trim()}>{loading ? 'Investigating…' : 'Investigate issue →'}</button>{data && <div className="investigation-report">{data.summary && <section className="report-summary"><div className="section-label">Summary</div><p>{data.summary}</p></section>}<section className="investigation-section"><div className="section-label">Confirmed evidence <span>{data.confirmedEvidence.length}</span></div>{data.confirmedEvidence.length ? <div className="evidence-list">{data.confirmedEvidence.map((finding, index) => <div className="finding" key={`${finding.path}-${finding.line}-${index}`}><span className="evidence">{finding.kind}</span><button className="evidence-link" onClick={() => openFile(finding.path)}><b>{finding.path}{finding.line !== null ? `:${finding.line}` : ''}</b></button>{finding.text && <p>{finding.text}</p>}</div>)}</div> : <div className="empty compact">No confirmed evidence was returned.</div>}</section><section className="investigation-section"><div className="section-label">Relevant files &amp; symbols <span>{data.relevantFiles.length}</span></div>{data.relevantFiles.length ? <div className="file-evidence">{data.relevantFiles.map(file => <div className="relevant-file" key={file.path}><code>{file.path}</code>{file.reason && <p>{file.reason}</p>}{file.symbols.length > 0 && <div className="symbol-list">{file.symbols.map(symbol => <span key={`${symbol.path}-${symbol.name}-${symbol.line}`}>{symbol.name}{symbol.line !== null ? `:${symbol.line}` : ''}<small>{symbol.kind}</small></span>)}</div>}</div>)}</div> : <div className="empty compact">No relevant files or symbols were identified.</div>}</section><section className="investigation-section"><div className="section-label">Hypotheses <span>{data.hypotheses.length}</span></div>{data.hypotheses.length ? data.hypotheses.map((hypothesis, index) => <div className="hypothesis" key={`${hypothesis.text}-${index}`}><p>{hypothesis.text}</p><div className="labels"><span className="confidence">Confidence: {hypothesis.confidence}</span>{hypothesis.evidence.map((label, evidenceIndex) => <span className="evidence-label" key={`${label}-${evidenceIndex}`}>Evidence: {label}</span>)}</div></div>) : <div className="empty compact">No hypotheses were generated.</div>}</section><InvestigationList title="Recommended next steps" items={data.recommendedNextSteps} /><InvestigationList title="Limitations" items={data.limitations} className="limitations" /></div>}</Card> }
function Architecture({ data, loading, selectFile }: { data: api.Graph | null; loading: boolean; selectFile: (path: string) => void }) {
  const [visible, setVisible] = useState(80)
  const [selectedNode, setSelectedNode] = useState('')
  const graph = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] }
    const sourceNodes = data.nodes.slice(0, visible)
    const known = new Set(sourceNodes.map(node => node.id))
    const visibleEdges = data.edges.filter(edge => known.has(edge.from)).slice(0, visible * 2)
    const targets = visibleEdges.map(edge => edge.to).filter(target => !known.has(target))
    const ids = [...sourceNodes.map(node => node.id), ...targets.filter((target, index) => targets.indexOf(target) === index)]
    return {
      nodes: ids.map((id, index) => ({ id, position: { x: (index % 4) * 230, y: Math.floor(index / 4) * 105 }, data: { label: id }, type: known.has(id) ? 'default' : 'input' })),
      edges: visibleEdges.map((edge, index) => ({ id: `import-${index}-${edge.from}-${edge.to}`, source: edge.from, target: edge.to, label: edge.evidence ? `line ${edge.evidence.line}` : 'direct import', data: edge })),
    }
  }, [data, visible])
  const selectedEdges = data?.edges.filter(edge => edge.from === selectedNode || edge.to === selectedNode) ?? []
  return <Card className="architecture-card"><ToolHeading glyph="⌬" title="Architecture map" detail="Direct import relationships only; an import does not prove a runtime call." />{loading ? <div className="empty" role="status">Building graph…</div> : data ? <><div className="graph-metrics"><Metric value={String(data.nodes.length)} label="Indexed nodes" /><Metric value={String(data.edges.length)} label="Direct imports" /><span className="graph-limit">Showing {graph.nodes.length} nodes · {graph.edges.length} edges</span></div>{data.edges.length > 0 ? <><div className="graph-wrap"><ReactFlow nodes={graph.nodes} edges={graph.edges} fitView minZoom={0.2} maxZoom={2} onNodeClick={(_, node) => { setSelectedNode(node.id); if (data.nodes.some(item => item.id === node.id && item.type === 'file')) selectFile(node.id) }}><MiniMap pannable zoomable /><Controls /><Background color="#25354b" gap={24} /></ReactFlow></div>{selectedNode && <div className="graph-evidence"><div className="eyebrow">RELATIONSHIP EVIDENCE · {selectedNode}</div>{selectedEdges.length ? selectedEdges.slice(0, 8).map((edge, index) => <div key={index}><code>{edge.from}</code><span>→</span><code>{edge.to}</code><small>{edge.evidence ? `line ${edge.evidence.line} · direct import` : 'direct import'}</small></div>) : <p>No direct import relationships for this node.</p>}</div>}{data.nodes.length > visible && <button className="outline graph-more" onClick={() => setVisible(value => value + 80)}>Expand graph (+80 nodes)</button>}</> : <div className="empty">No direct import relationships were extracted from the indexed files.</div>}{data.limitations?.length ? <div className="limitations"><div className="section-label">Analysis boundaries</div><ul>{data.limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div> : null}</> : <div className="empty">Select Architecture to build an evidence-backed graph summary.</div>}</Card> }
function ToolHeading({ glyph, title, detail }: { glyph: string; title: string; detail: string }) { return <div className="tool-title"><div className="tool-symbol">{glyph}</div><div><h2>{title}</h2><p>{detail}</p></div></div> }
function FilePreview({ path, content, loading }: { path: string; content: string; loading: boolean }) { return <Card className="preview"><div className="card-head"><div><div className="eyebrow">SOURCE VIEWER</div><h2>{path}</h2></div><span className="pill">Read-only</span></div>{loading ? <div className="empty">Loading source…</div> : <pre>{content.split('\n').map((line, index) => <div key={index}><span>{String(index + 1).padStart(3, ' ')}</span>{line}</div>)}</pre>}</Card> }

export default App
