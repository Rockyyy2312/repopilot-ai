import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import * as api from './api'
import { pathForRoute, routeForPath, type AppRoute, type RouteName } from './routing'
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

type Tab = 'overview' | 'search' | 'investigate' | 'architecture'

const icon = (value: string) => <span className="ico" aria-hidden="true">{value}</span>

function App() {
  const [project, setProject] = useState<api.ImportResponse | null>(null)
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
  const [investigation, setInvestigation] = useState<api.Investigation | null>(null)
  const [graphData, setGraphData] = useState<api.Graph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [user, setUser] = useState<api.AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authUnavailable, setAuthUnavailable] = useState(false)

  const tab: Tab = route.name === 'search' || route.name === 'investigate' || route.name === 'architecture' ? route.name : 'overview'
  const navigate = (name: Exclude<RouteName, 'landing' | 'not-found'>, replace = false) => {
    const path = pathForRoute(name)
    if (replace) window.history.replaceState({}, '', path); else window.history.pushState({}, '', path)
    setRoute(routeForPath(path))
  }

  const clearSessionCache = () => { sessionStorage.removeItem('repopilot.project') }

  useEffect(() => {
    void api.me().then(result => {
      setAuthUnavailable(false)
      setUser(result.user)
      clearSessionCache()
      if (!result.authenticated) {
        setProject(null)
        sessionStorage.removeItem('repopilot.project')
      }
    }).catch(() => {
      setUser(null)
      setAuthUnavailable(true)
    }).finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    const onPopState = () => setRoute(routeForPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (project && route.name === 'landing') navigate('overview', true)
    if (!project && route.name !== 'landing' && route.name !== 'not-found') { window.history.replaceState({}, '', '/'); setRoute({ name: 'landing' }) }
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
  }

  const run = async (task: () => Promise<void>) => {
    setLoading(true); setError('')
    try { await task() } catch (reason) {
      const status = reason instanceof Error ? (reason as Error & { status?: number }).status : undefined
      if (status === 401) { clearWorkspace(); setUser(null); window.history.replaceState({}, '', '/'); setRoute({ name: 'landing' }); setError('Your session expired. Please sign in again.') }
      else if (status === 404) { clearWorkspace(); navigate('overview', true); setError('That project is no longer available. Import it again.') }
      else setError(reason instanceof Error ? reason.message : 'Something went wrong')
    } finally { setLoading(false) }
  }

  const loadProject = async (imported: api.ImportResponse) => {
    const response = await api.getTree(imported.id)
    setProject(imported)
    setTree(response.files)
    navigate('overview', true)
    setSelected('')
    setContent('')
    setResults([])
    setInvestigation(null)
    setGraphData(null)
  }

  const submitUrl = () => url.trim() && run(async () => loadProject(await api.importGithub(url.trim())))
  const upload = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) run(async () => loadProject(await api.importArchive(file))) }

  useEffect(() => {
    const filePath = route.filePath || selected
    if (!project || !filePath) return
    if (route.filePath && route.filePath !== selected) setSelected(route.filePath)
    void run(async () => setContent((await api.getFile(project.id, filePath)).content))
  }, [project, selected, route.filePath])

  const doSearch = () => project && query.trim() && run(async () => { setResults(await api.search(project.id, query.trim())); navigate('search') })
  const doInvestigation = () => project && question.trim() && run(async () => { setInvestigation(await api.investigate(project.id, { question: question.trim(), error_message: errorMessage.trim(), stack_trace: stackTrace })); navigate('investigate') })
  const loadGraph = () => project && run(async () => { setGraphData(await api.graph(project.id)); navigate('architecture') })
  const downloadReport = () => project && run(async () => { const { markdown } = await api.report(project.id); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' })); link.download = `${project.repository_name}-report.md`; link.click(); URL.revokeObjectURL(link.href) })
  const openFile = (path: string) => { setSelected(path); window.history.pushState({}, '', `/file/${encodeURIComponent(path)}`); setRoute({ name: 'overview', filePath: path }) }

  if (authLoading) return <div className="app min-h-screen"><Header project={null} user={null} /><main className="loading-screen"><div className="loader-orb">✦</div><p>Checking your secure session…</p></main></div>
  if (authUnavailable) return <Unavailable onRetry={() => window.location.reload()} />
  if (!user) return <AuthLanding onAuthenticated={(nextUser) => { setAuthUnavailable(false); setUser(nextUser) }} />
  if (route.name === 'not-found') return <div className="app min-h-screen"><Header project={project} user={user} onLogout={() => { void api.logout(); clearWorkspace(); clearSessionCache(); setUser(null) }} /><NotFound navigate={() => navigate('overview')} /></div>
  if (!project) return <div className="app min-h-screen"><Header project={null} user={user} onLogout={() => { void api.logout(); clearWorkspace(); clearSessionCache(); setUser(null) }} /><main className="shell"><Sidebar project={null} route={route} navigate={navigate} loadGraph={() => setError('Import a repository before opening Architecture.')} onBlocked={() => setError('Import a repository first to use this workspace tool.')} /><section className="content">{error && <Alert message={error} clear={() => setError('')} />}<LandingCopy /><ImportCard url={url} setUrl={setUrl} submitUrl={submitUrl} upload={upload} loading={loading} /></section></main></div>
  return <div className="app min-h-screen">
    <Header project={project} user={user} onLogout={() => { void api.logout(); clearWorkspace(); clearSessionCache(); setUser(null); window.history.replaceState({}, '', '/') }} />
    <main className="shell">
      <Sidebar project={project} route={route} navigate={navigate} loadGraph={loadGraph} onBlocked={() => setError('Import a repository first to use this workspace tool.')} />
      <section className="content">
        <div className="topline"><div><div className="eyebrow">{project ? 'PROJECT ANALYSIS' : 'GET STARTED'}</div><h1>{project ? 'Understand your codebase.' : 'Bring a repository into focus.'}</h1><p className="subtitle">{project ? 'Trace evidence, inspect files, and turn questions into grounded findings.' : 'Import a public GitHub repository or local archive to explore it with evidence.'}</p></div>{project && <button className="outline" onClick={downloadReport}>{icon('↓')} Download report</button>}</div>
        {error && <Alert message={error} clear={() => setError('')} />}
        {!project ? <><LandingCopy /><ImportCard url={url} setUrl={setUrl} submitUrl={submitUrl} upload={upload} loading={loading} /></> : <Workspace project={project} tree={tree} selected={route.filePath || selected} setSelected={openFile} content={content} tab={tab} navigate={navigate} loading={loading} query={query} setQuery={setQuery} doSearch={doSearch} results={results} question={question} setQuestion={setQuestion} errorMessage={errorMessage} setErrorMessage={setErrorMessage} stackTrace={stackTrace} setStackTrace={setStackTrace} doInvestigation={doInvestigation} investigation={investigation} graphData={graphData} openFile={openFile} />}
      </section>
    </main>
  </div>
}

function Header({ project, user, onLogout }: { project: api.ImportResponse | null; user: api.AuthUser | null; onLogout?: () => void }) { return <header><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="header-right"><span className="status-dot" /> {project ? <span className="header-repo">{project.repository_name}</span> : 'Secure workspace'} {user && <><span className="user-email">{user.email}</span><button className="logout-button" onClick={onLogout}>Log out</button></>}</div></header> }

function LandingCopy() { return <div className="landing-copy"><div className="eyebrow">CODE INTELLIGENCE WORKSPACE</div><h2>Understand every layer of your repository.</h2><p>Import a public codebase, trace evidence, and investigate issues without executing untrusted source.</p><div className="landing-points"><span>✦ Evidence-backed findings</span><span>⌁ Direct import relationships</span><span>◈ Private workspace session</span></div></div> }

function Unavailable({ onRetry }: { onRetry: () => void }) { return <div className="auth-page unavailable-page"><div className="auth-panel"><div className="auth-panel-inner"><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="eyebrow">WORKSPACE UNAVAILABLE</div><h2>Connect to the RepoPilot backend</h2><p className="auth-detail">The frontend could not reach the API. Start FastAPI on port 8000, then retry.</p><button className="primary auth-submit" onClick={onRetry}>Retry connection</button></div></div></div> }

function AuthLanding({ onAuthenticated }: { onAuthenticated: (user: api.AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { const result = mode === 'login' ? await api.login(email, password) : await api.register(email, password); onAuthenticated(result.user) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication failed') } finally { setBusy(false) } }
  return <div className="auth-page"><div className="auth-visual"><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="auth-hero"><div className="eyebrow">YOUR CODEBASE, IN FOCUS</div><h1>Make complex systems legible.</h1><p>Search evidence, inspect architecture, and investigate failures in one private workspace.</p></div><div className="auth-glow" /></div><div className="auth-panel"><div className="auth-panel-inner"><div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'CREATE WORKSPACE'}</div><h2>{mode === 'login' ? 'Sign in to RepoPilot' : 'Start your workspace'}</h2><p className="auth-detail">{mode === 'login' ? 'Continue your repository analysis session.' : 'Use a secure account to keep your workspace private.'}</p><form onSubmit={submit}><label>Email<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /><small>At least 10 characters.</small></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="primary auth-submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in →' : 'Create account →'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button></div></div></div>
}

function Sidebar({ project, route, navigate, loadGraph, onBlocked }: { project: api.ImportResponse | null; route: AppRoute; navigate: (name: Exclude<RouteName, 'landing' | 'not-found'>) => void; loadGraph: () => void; onBlocked: () => void }) { return <aside><div className="eyebrow">WORKSPACE</div><div className="workspace"><div className="repo-icon">⌁</div><div><b>{project ? project.repository_name : 'Your workspace'}</b><small>{project ? project.source.url?.replace('https://github.com/', '') || project.source.filename : 'Import a codebase to begin'}</small></div></div><nav>{[['overview', '▦', 'Overview'], ['search', '⌕', 'Code search'], ['investigate', '◈', 'Investigate issue']].map(([value, glyph, label]) => <button key={value} className={route.name === value ? 'active' : ''} onClick={() => project || value === 'overview' ? navigate(value as Exclude<RouteName, 'landing' | 'not-found'>) : onBlocked()}>{icon(glyph)} {label}</button>)}<button className={route.name === 'architecture' ? 'active' : ''} onClick={() => project ? loadGraph() : onBlocked()}>{icon('⌬')} Architecture</button></nav><div className="aside-foot"><div className="limit"><b>Evidence-first analysis</b><span>Results link back to source files and lines.</span></div><small>REPOPILOT AI · PHASE 3</small></div></aside> }

function Alert({ message, clear }: { message: string; clear: () => void }) { return <div className="alert" role="alert">{icon('!')}<div><b>Something needs attention</b><span>{message}</span></div><button onClick={clear} aria-label="Dismiss error">×</button></div> }

function ImportCard({ url, setUrl, submitUrl, upload, loading }: { url: string; setUrl: (value: string) => void; submitUrl: () => void; upload: (event: ChangeEvent<HTMLInputElement>) => void; loading: boolean }) { return <div className="import-grid"><div className="card import-main"><div className="card-icon">⌘</div><h2>Import from GitHub</h2><p>Paste a public repository URL. The backend validates, downloads, and analyzes a safe snapshot.</p><div className="url-row"><input aria-label="GitHub repository URL" placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => event.key === 'Enter' && submitUrl()} /><button onClick={submitUrl} disabled={loading || !url.trim()}>{loading ? 'Analyzing…' : 'Import repository'} <span>→</span></button></div><div className="hint">{icon('i')} Public GitHub repositories only · no Git history</div></div><label className="card dropzone"><div className="upload-icon">↥</div><h2>Upload an archive</h2><p>ZIP, TAR, or TAR.GZ · securely inspected in memory</p><span className="button-secondary">Choose file</span><input type="file" accept=".zip,.tar,.tar.gz,.tgz" onChange={upload} /></label><div className="trust"><span>✦</span><b>Grounded by evidence</b><small>Imported code is never executed. Unsupported files are flagged instead of guessed.</small></div></div> }

 function Workspace({ project, tree, selected, setSelected, content, tab, navigate, loading, query, setQuery, doSearch, results, question, setQuestion, errorMessage, setErrorMessage, stackTrace, setStackTrace, doInvestigation, investigation, graphData, openFile }: { project: api.ImportResponse; tree: string[]; selected: string; setSelected: (path: string) => void; content: string; tab: Tab; navigate: (name: Exclude<RouteName, 'landing' | 'not-found'>) => void; loading: boolean; query: string; setQuery: (value: string) => void; doSearch: () => void; results: api.SearchResult[]; question: string; setQuestion: (value: string) => void; errorMessage: string; setErrorMessage: (value: string) => void; stackTrace: string; setStackTrace: (value: string) => void; doInvestigation: () => void; investigation: api.Investigation | null; graphData: api.Graph | null; openFile: (path: string) => void }) { return <><div className="tabs">{(['overview', 'search', 'investigate', 'architecture'] as Tab[]).map(value => <button className={tab === value ? 'selected' : ''} onClick={() => navigate(value === 'overview' ? 'overview' : value)} key={value}>{value === 'overview' ? 'Project status' : value[0].toUpperCase() + value.slice(1)}</button>)}</div>{tab === 'overview' && <Overview project={project} tree={tree} selected={selected} setSelected={setSelected} loading={loading} />}{tab === 'search' && <Search query={query} setQuery={setQuery} submit={doSearch} results={results} select={openFile} loading={loading} />}{tab === 'investigate' && <><InvestigationContext errorMessage={errorMessage} setErrorMessage={setErrorMessage} stackTrace={stackTrace} setStackTrace={setStackTrace} /><Investigate question={question} setQuestion={setQuestion} submit={doInvestigation} data={investigation} loading={loading} /></>}{tab === 'architecture' && <Architecture data={graphData} loading={loading} selectFile={openFile} />}{tab === 'overview' && selected && <FilePreview path={selected} content={content} loading={loading} />}</> }

function NotFound({ navigate, title = 'Route not found', detail = 'Use the workspace navigation to continue.' }: { navigate: () => void; title?: string; detail?: string }) { return <main className="not-found"><div className="not-found-mark">404</div><div className="eyebrow">REPOPILOT ROUTER</div><h1>{title}</h1><p>{detail}</p><button className="primary" onClick={navigate}>Return to workspace</button></main> }

function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`card ${className}`}>{children}</div> }
function InvestigationContext({ errorMessage, setErrorMessage, stackTrace, setStackTrace }: { errorMessage: string; setErrorMessage: (value: string) => void; stackTrace: string; setStackTrace: (value: string) => void }) { return <Card className="investigation-context"><div className="eyebrow">OPTIONAL RUNTIME CONTEXT</div><p>These fields are sent to the backend as evidence inputs; a stack-trace location does not prove a root cause.</p><input className="investigation-input" aria-label="Error message" placeholder="Error message (optional)" value={errorMessage} onChange={event => setErrorMessage(event.target.value)} /><textarea className="stack-input" aria-label="Stack trace" placeholder="Stack trace (optional)" value={stackTrace} onChange={event => setStackTrace(event.target.value)} /></Card> }
function Overview({ project, tree, selected, setSelected, loading }: { project: api.ImportResponse; tree: string[]; selected: string; setSelected: (path: string) => void; loading: boolean }) { return <div className="overview-grid"><Card className="status-card"><div className="card-head"><div><div className="eyebrow">PROJECT STATUS</div><h2>{project.repository_name}</h2></div><span className="pill green">{loading ? 'Syncing…' : 'Indexed'}</span></div><div className="metrics"><Metric value={String(project.file_count)} label="Files indexed" /><Metric value={String(project.symbol_count)} label="Symbols found" /><Metric value={String(project.import_count)} label="Import edges" /></div><div className="language-row"><span className="eyebrow">LANGUAGES</span>{Object.entries(project.languages).map(([language, count]) => <span className="language-pill" key={language}>{language} <b>{count}</b></span>)}</div><div className="notice"><span>✓</span><div><b>Analysis is grounded in the imported snapshot</b><small>Warnings below reflect files the analyzer could not safely parse or include.</small></div></div>{project.warnings.length > 0 && <div className="warning-list"><div className="eyebrow">ANALYSIS WARNINGS · {project.warnings.length}</div>{project.warnings.slice(0, 6).map((warning, index) => <div key={`${warning.path}-${index}`}><code>{warning.path}</code><span>{warning.reason}</span></div>)}</div>}</Card><Card className="tree"><div className="card-head"><div><div className="eyebrow">FILE EXPLORER</div><h2>Browse source</h2></div><span className="count">{tree.length} files</span></div>{tree.length ? tree.map(path => <button className={selected === path ? 'file selected-file' : 'file'} onClick={() => setSelected(path)} key={path}>{icon(path.split('/').length > 1 ? '·' : '›')}<span>{path}</span></button>) : <div className="empty">No files were returned by the importer.</div>}</Card></div> }
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

function Search({ query, setQuery, submit, results, select, loading }: { query: string; setQuery: (value: string) => void; submit: () => void; results: api.SearchResult[]; select: (path: string) => void; loading: boolean }) {
  const trimmedQuery = query.trim()
  const message = loading ? 'Scanning indexed files…' : !trimmedQuery ? 'Enter a query to search indexed source files.' : 'No matching evidence was found.'
  return <Card className="tool"><ToolHeading glyph="⌕" title="Search the codebase" detail="Find exact evidence across indexed file contents." /><div className="search-row"><input aria-label="Search query" placeholder="Search for a symbol, error, or phrase…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && submit()} /><button onClick={submit} disabled={loading || !trimmedQuery}>{loading ? 'Searching…' : 'Search'}</button></div>{results.length && trimmedQuery ? <div className="result-list">{results.map((result, index) => <button className="result" key={`${result.path}-${result.line}-${index}`} onClick={() => select(result.path)}><div className="result-meta"><span className="result-kind">{result.kind}</span>{result.language && <span>{result.language}</span>}<b>{result.path}</b><span>line {result.line}</span></div><code>{highlightMatches(result.text, query)}</code></button>)}</div> : <div className="empty">{message}</div>}</Card>
}
 function InvestigationList({ title, items, className = '' }: { title: string; items: string[]; className?: string }) { return <section className={`investigation-section ${className}`}><div className="section-label">{title} <span>{items.length}</span></div>{items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <div className="empty compact">None reported.</div>}</section> }
function Investigate({ question, setQuestion, submit, data, loading }: { question: string; setQuestion: (value: string) => void; submit: () => void; data: api.Investigation | null; loading: boolean }) { return <Card className="tool"><ToolHeading glyph="◈" title="Investigate an issue" detail="Ask a focused question and review grounded findings." /><textarea aria-label="Investigation question" placeholder="e.g. Why does authentication fail on startup?" value={question} onChange={event => setQuestion(event.target.value)} /><button className="primary full" onClick={submit} disabled={loading || !question.trim()}>{loading ? 'Investigating…' : 'Investigate issue →'}</button>{data && <div className="investigation-report">{data.summary && <section className="report-summary"><div className="section-label">Summary</div><p>{data.summary}</p></section>}<section className="investigation-section"><div className="section-label">Confirmed evidence <span>{data.confirmedEvidence.length}</span></div>{data.confirmedEvidence.length ? <div className="evidence-list">{data.confirmedEvidence.map((finding, index) => <div className="finding" key={`${finding.path}-${finding.line}-${index}`}><span className="evidence">{finding.kind}</span><b>{finding.path}{finding.line !== null ? `:${finding.line}` : ''}</b>{finding.text && <p>{finding.text}</p>}</div>)}</div> : <div className="empty compact">No confirmed evidence was returned.</div>}</section><section className="investigation-section"><div className="section-label">Relevant files &amp; symbols <span>{data.relevantFiles.length}</span></div>{data.relevantFiles.length ? <div className="file-evidence">{data.relevantFiles.map(file => <div className="relevant-file" key={file.path}><code>{file.path}</code>{file.reason && <p>{file.reason}</p>}{file.symbols.length > 0 && <div className="symbol-list">{file.symbols.map(symbol => <span key={`${symbol.path}-${symbol.name}-${symbol.line}`}>{symbol.name}{symbol.line !== null ? `:${symbol.line}` : ''}<small>{symbol.kind}</small></span>)}</div>}</div>)}</div> : <div className="empty compact">No relevant files or symbols were identified.</div>}</section><section className="investigation-section"><div className="section-label">Hypotheses <span>{data.hypotheses.length}</span></div>{data.hypotheses.length ? data.hypotheses.map((hypothesis, index) => <div className="hypothesis" key={`${hypothesis.text}-${index}`}><p>{hypothesis.text}</p><div className="labels"><span className="confidence">Confidence: {hypothesis.confidence}</span>{hypothesis.evidence.map((label, evidenceIndex) => <span className="evidence-label" key={`${label}-${evidenceIndex}`}>Evidence: {label}</span>)}</div></div>) : <div className="empty compact">No hypotheses were generated.</div>}</section><InvestigationList title="Recommended next steps" items={data.recommendedNextSteps} /><InvestigationList title="Limitations" items={data.limitations} className="limitations" /></div>}</Card> }
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
  return <Card className="architecture-card"><ToolHeading glyph="⌬" title="Architecture map" detail="Direct import relationships only; an import does not prove a runtime call." />{loading ? <div className="empty">Building graph…</div> : data ? data.edges.length ? <><div className="graph-metrics"><Metric value={String(data.nodes.length)} label="File nodes" /><Metric value={String(data.edges.length)} label="Direct imports" /><span className="graph-limit">Showing {graph.nodes.length} nodes · {graph.edges.length} edges</span></div><div className="graph-wrap"><ReactFlow nodes={graph.nodes} edges={graph.edges} fitView minZoom={0.2} maxZoom={2} onNodeClick={(_, node) => { setSelectedNode(node.id); if (data.nodes.some(item => item.id === node.id)) selectFile(node.id) }}><MiniMap pannable zoomable /><Controls /><Background color="#25354b" gap={24} /></ReactFlow></div>{selectedNode && <div className="graph-evidence"><div className="eyebrow">RELATIONSHIP EVIDENCE · {selectedNode}</div>{selectedEdges.length ? selectedEdges.slice(0, 8).map((edge, index) => <div key={index}><code>{edge.from}</code><span>→</span><code>{edge.to}</code><small>{edge.evidence ? `line ${edge.evidence.line} · direct import` : 'direct import'}</small></div>) : <p>No direct import relationships for this node.</p>}</div>}{data.nodes.length > visible && <button className="outline graph-more" onClick={() => setVisible(value => value + 80)}>Expand graph (+80 nodes)</button>}</> : <div className="empty">No import relationships were extracted from the indexed files.</div> : <div className="empty">Select Architecture to build an evidence-backed graph summary.</div>}</Card> }
function ToolHeading({ glyph, title, detail }: { glyph: string; title: string; detail: string }) { return <div className="tool-title"><div className="tool-symbol">{glyph}</div><div><h2>{title}</h2><p>{detail}</p></div></div> }
function FilePreview({ path, content, loading }: { path: string; content: string; loading: boolean }) { return <Card className="preview"><div className="card-head"><div><div className="eyebrow">SOURCE VIEWER</div><h2>{path}</h2></div><span className="pill">Read-only</span></div>{loading ? <div className="empty">Loading source…</div> : <pre>{content.split('\n').map((line, index) => <div key={index}><span>{String(index + 1).padStart(3, ' ')}</span>{line}</div>)}</pre>}</Card> }

export default App
