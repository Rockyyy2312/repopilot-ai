import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as api from './api'
import { getOverview, searchPage } from './workspaceApi'
import './explorer-screens.css'

type ProjectProps = { project: api.ImportResponse }
type SourceLocation = { path: string; line?: number }
type Overview = Awaited<ReturnType<typeof getOverview>>
type SearchPage = Awaited<ReturnType<typeof searchPage>>
type SearchFilters = { query: string; path: string; language: string; kind: string }
const number = (value: number) => value.toLocaleString()
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
const filename = (path: string) => path.split('/').pop() || path
const languageColors = ['#00855d', '#006398', '#8b7fd1', '#e5ae43', '#94a6bb']

function Icon({ name, className = '' }: { name: 'search' | 'folder' | 'code' | 'arrow' | 'check' | 'issue' | 'file' | 'layers' | 'download' | 'clock' | 'close'; className?: string }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    folder: <path d="M3 7V5h6l2 3h10v12H3V7Z" />,
    code: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    issue: <><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" /><path d="M12 7v6m0 3v1" /></>,
    file: <><path d="M5 3h9l5 5v13H5Z" /><path d="M14 3v6h5M8 13h8m-8 4h6" /></>,
    layers: <><path d="m12 3 10 6-10 6L2 9ZM2 14l10 6 10-6M2 18l10 5 10-5" /></>,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  }
  return <svg className={`ex-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Panel({ title, icon, action, children, className = '' }: { title: string; icon?: Parameters<typeof Icon>[0]['name']; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ex-panel ${className}`}><div className="ex-panel-heading"><h2>{icon && <span className="ex-icon-tile"><Icon name={icon} /></span>}{title}</h2>{action}</div>{children}</section>
}

function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="ex-error" role="alert"><Icon name="issue" /><span>{message}</span>{retry && <button className="ex-button ex-button-small" onClick={retry}>Try again</button>}</div>
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ex-empty"><span className="ex-empty-icon"><Icon name="search" /></span><h3>{title}</h3><p>{children}</p></div>
}

function downloadReport(markdown: string, name: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '-')}-report.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  return index < 0 ? <>{text}</> : <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>
}

function SourcePane({ project, location, query = '', onClose }: ProjectProps & { location: SourceLocation | null; query?: string; onClose?: () => void }) {
  const [source, setSource] = useState<{ path: string; content: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [full, setFull] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const selectedLine = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const path = location?.path
  useEffect(() => {
    let active = true
    setSource(null); setError(''); setCopyStatus(''); setFull(false)
    if (!path) { setLoading(false); return }
    setLoading(true)
    api.getFile(project.id, path).then(value => { if (active) setSource(value) }).catch(reason => { if (active) setError(errorMessage(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.id, path, retry])
  useEffect(() => {
    if (full && selectedLine.current) selectedLine.current.scrollIntoView?.({ block: 'nearest' })
  }, [source, location?.line, full])
  useEffect(() => {
    if (onClose && location) closeButton.current?.focus()
  }, [onClose, location])
  const lines = source?.content.split('\n') || []
  const line = Math.max(1, location?.line || 1)
  const start = full ? 0 : Math.max(0, Math.min(line - 12, lines.length - 30))
  const end = full ? lines.length : Math.min(lines.length, Math.max(start + 36, line + 16))
  const fileAnalysis = project.analysis.files.find(file => file.path === path)
  const copy = async () => {
    if (!source) return
    try { await navigator.clipboard.writeText(source.content); setCopyStatus('Copied') }
    catch { setCopyStatus('Copy unavailable; select and copy the source below.') }
  }
  return <section className="ex-source" aria-label="Source inspector">
     <header className="ex-source-header"><Icon name="code" /><div className="ex-source-title"><h2>{path ? filename(path) : 'Source inspector'}</h2><span className="ex-mono">{path || 'Select a result to inspect its source'}</span></div>{source && <button className="ex-button ex-button-small" onClick={copy}>Copy code</button>}{onClose && location && <button ref={closeButton} className="ex-icon-button" aria-label="Close source inspector" onClick={onClose}><Icon name="close" /></button>}</header>
    {location && <div className="ex-source-toolbar"><span>{source ? `Lines ${start + 1}–${end} of ${lines.length}` : 'Repository snapshot'}</span><span className="ex-green">{location.line ? `Selected line ${location.line}` : 'File context'}</span></div>}
    {loading ? <div className="ex-loading" role="status">Loading source…</div> : error ? <ErrorNotice message={error} retry={() => setRetry(value => value + 1)} /> : source ? <>
      <div className="ex-code-scroll" tabIndex={0} aria-label={`Source of ${source.path}`}><div className="ex-code">{lines.slice(start, end).map((text, index) => <div key={start + index} ref={start + index + 1 === line ? selectedLine : undefined} className={`ex-code-line ${start + index + 1 === location?.line ? 'ex-code-selected' : ''}`} aria-current={start + index + 1 === location?.line ? 'location' : undefined}><span className="ex-line-number">{start + index + 1}</span><code><Highlight text={text || ' '} query={query} /></code></div>)}</div></div>
      <footer className="ex-source-footer"><span>{fileAnalysis?.language || 'Text'} · Imported snapshot · Read-only</span>{lines.length > 36 && <button className="ex-link" onClick={() => setFull(value => !value)}>{full ? 'Show matching context' : 'Show full file'}</button>}</footer>
      {fileAnalysis && <div className="ex-source-facts"><span>{fileAnalysis.symbols.length} indexed symbols</span><span>{fileAnalysis.imports.length} imports</span><span>{fileAnalysis.status}</span>{fileAnalysis.limitation && <p>{fileAnalysis.limitation}</p>}</div>}
      {copyStatus && <p className="ex-copy-status" role="status">{copyStatus}</p>}
    </> : <Empty title="Read the code in context">Open a file or evidence match. Its source and highlighted line will appear here without leaving your work.</Empty>}
  </section>
}

type OverviewProps = ProjectProps & { initialFilePath?: string; onNavigate: (page: 'search' | 'investigate' | 'architecture' | 'repositories') => void; onOpenFile: (path: string, line?: number) => void }
export function OverviewScreen(props: OverviewProps) { return <OverviewContent key={props.project.id} {...props} /> }

function OverviewContent({ project, initialFilePath, onNavigate, onOpenFile }: OverviewProps) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [showWarnings, setShowWarnings] = useState(false)
  const [sourceLocation, setSourceLocation] = useState<SourceLocation | null>(initialFilePath ? { path: initialFilePath } : null)
  useEffect(() => {
    setSourceLocation(initialFilePath ? { path: initialFilePath } : null)
  }, [initialFilePath])
  useEffect(() => {
    let active = true
    setError('')
    getOverview(project.id).then(value => { if (active) setOverview(value) }).catch(reason => { if (active) setError(errorMessage(reason)) })
    return () => { active = false }
  }, [project.id, retry])
  const exportSummary = async () => {
    setExporting(true); setExportError('')
    try { downloadReport((await api.report(project.id)).markdown, project.repository_name) }
    catch (reason) { setExportError(errorMessage(reason)) }
    finally { setExporting(false) }
  }
  const languages = overview?.languages || []
  const totalLanguageFiles = languages.reduce((sum, item) => sum + item.files, 0)
  const warnings = overview?.warnings || project.warnings
  const indexedDate = overview?.indexed_at ? new Date(overview.indexed_at < 1e12 ? overview.indexed_at * 1000 : overview.indexed_at).toLocaleString() : null
  const openPackage = (path: string) => {
    const file = project.analysis.files.find(item => path === '.' || item.path === path || item.path.startsWith(`${path}/`))
    if (file) setSourceLocation({ path: file.path })
    else onNavigate('architecture')
  }
  return <div className="ex-screen ex-overview">
    <div className="ex-status-strip"><div className="ex-pills"><span className="ex-pill"><span className="ex-dot" />Repository overview</span><span className="ex-pill ex-pill-blue"><Icon name="layers" />Imported snapshot</span>{indexedDate && <span className="ex-meta"><Icon name="clock" />Indexed {indexedDate}</span>}</div><button className="ex-link" onClick={() => onNavigate('repositories')}>Manage repositories <Icon name="arrow" /></button></div>
    <div className="ex-page-heading"><div><h1>Codebase Overview</h1><p>A clear view of <strong>{project.repository_name}</strong> — structure, source, and analysis.</p></div><div className="ex-actions"><button className="ex-button" disabled={exporting} onClick={exportSummary}><Icon name="download" />{exporting ? 'Exporting…' : 'Export summary'}</button><button className="ex-button ex-button-primary" onClick={() => onNavigate('investigate')}><Icon name="issue" />Investigate an issue</button></div></div>
    {error && <ErrorNotice message={error} retry={() => setRetry(value => value + 1)} />}{exportError && <ErrorNotice message={exportError} />}
    {!overview && !error && <div className="ex-loading" role="status">Loading snapshot statistics…</div>}
    <div className="ex-metrics">
      <div className="ex-metric"><div className="ex-metric-label">Total files<span className="ex-icon-tile"><Icon name="file" /></span></div><strong className="ex-metric-value">{number(project.file_count)}</strong><span className="ex-meta ex-green">{overview ? `${number(overview.analyzed_files)} files structurally analyzed` : 'Files in the imported snapshot'}</span></div>
      <div className="ex-metric"><div className="ex-metric-label">Codebase size<span className="ex-icon-tile ex-tile-blue"><Icon name="code" /></span></div><strong className="ex-metric-value">{overview ? number(overview.total_lines) : '—'} <small>LOC</small></strong><span className="ex-meta">{overview ? `${number(overview.total_bytes)} bytes of source` : 'Calculating source statistics'}</span></div>
      <div className="ex-metric"><div className="ex-metric-label">Languages<span className="ex-icon-tile ex-tile-green"><Icon name="layers" /></span></div><strong className="ex-language-primary">{languages[0]?.name || 'No language data'}{languages[0] && <span>{Math.round(languages[0].files / (totalLanguageFiles || 1) * 100)}%</span>}</strong><div className="ex-language-bar" aria-label="Language distribution by file count">{languages.map((language, index) => <span key={language.name} style={{ width: `${language.files / (totalLanguageFiles || 1) * 100}%`, background: languageColors[index % languageColors.length] }} title={`${language.name}: ${language.files} files`} />)}</div><span className="ex-meta">{languages.length} detected languages · by file count</span></div>
      <div className="ex-metric"><div className="ex-metric-label">Indexed symbols<span className="ex-icon-tile"><Icon name="search" /></span></div><strong className="ex-metric-value">{number(project.symbol_count)}</strong><span className="ex-meta ex-blue">{number(project.import_count)} import references extracted</span></div>
    </div>
    <div className="ex-overview-grid"><div className="ex-stack">
      <Panel title="Key Packages & Directories" icon="folder" action={<button className="ex-link" onClick={() => onNavigate('architecture')}>Browse structure <Icon name="arrow" /></button>}><p className="ex-description">Directory-level source statistics from this repository snapshot.</p><div className="ex-package-list">{overview?.packages.length ? overview.packages.slice(0, 8).map(item => <button className="ex-package" key={item.path} onClick={() => openPackage(item.path)}><span className="ex-folder-tile"><Icon name="folder" /></span><span className="ex-package-name"><strong>{item.path}</strong><small>{number(item.symbols)} indexed symbols</small></span><span className="ex-package-stats"><strong>{number(item.lines)} <small>LOC</small></strong><small>{number(item.files)} files</small></span><Icon name="arrow" /></button>) : <p className="ex-muted">{overview ? 'No source directories were detected.' : 'Directory statistics will appear after loading.'}</p>}</div></Panel>
      <Panel title="Snapshot Activity" icon="clock" action={<span className="ex-meta">Current import</span>}><div className="ex-timeline"><div><span className="ex-timeline-dot" /><strong>Repository snapshot imported</strong><p>{project.source.type === 'github' ? project.source.url : project.source.filename || project.repository_name}</p></div><div><span className="ex-timeline-dot ex-dot-blue" /><strong>{number(project.file_count)} files indexed for source search</strong><p>{indexedDate || 'Import timestamp is unavailable.'}</p></div><div><span className="ex-timeline-dot" /><strong>{number(project.symbol_count)} symbols and {number(project.import_count)} imports extracted</strong><p>Static source analysis. This snapshot does not include live commit activity.</p></div></div></Panel>
    </div><div className="ex-stack">
      <Panel title="Analysis Coverage" icon="check" action={<span className={`ex-pill ${warnings.length ? 'ex-pill-amber' : 'ex-pill-green'}`}>{warnings.length ? `${warnings.length} notices` : 'Snapshot analyzed'}</span>}><p className="ex-description">Source evidence is available for inspection. Runtime behavior, test coverage, and security are not evaluated.</p><div className="ex-coverage-grid"><div><span>Structural analysis</span><strong>{overview ? number(overview.analyzed_files) : '—'}</strong><small>files analyzed</small></div><div><span>Text index</span><strong>{number(project.file_count)}</strong><small>snapshot files</small></div></div>{warnings.length > 0 && <div className="ex-warning"><div><Icon name="issue" /><strong>Some source has analysis limitations</strong></div><p>{warnings[0].reason}</p><button className="ex-link" onClick={() => setShowWarnings(value => !value)}>{showWarnings ? 'Hide' : 'Review'} all {warnings.length} notices</button>{showWarnings && <ul className="ex-warning-list">{warnings.map((warning, index) => <li key={`${warning.path}-${index}`}><strong>{warning.path}</strong><span>{warning.reason}</span></li>)}</ul>}</div>}</Panel>
      <Panel title="Language Distribution" icon="code"><div className="ex-language-list">{languages.length ? languages.map((language, index) => <div key={language.name}><span><i style={{ background: languageColors[index % languageColors.length] }} />{language.name}</span><span>{number(language.files)} files <small>· {number(language.lines)} LOC</small></span></div>) : <p className="ex-muted">No language distribution available.</p>}</div></Panel>
       <Panel title="Declared Dependencies" icon="layers" action={<span className="ex-meta">{overview?.dependencies.length ?? '—'} entries</span>}><div className="ex-dependencies">{overview?.dependencies.length ? overview.dependencies.slice(0, 6).map((dependency, index) => <button className="ex-dependency" key={`${dependency.path}-${dependency.name}-${index}`} onClick={() => setSourceLocation({ path: dependency.path })} title={`Open ${dependency.path}`}><span>{dependency.name}</span><code>{dependency.version || 'Unspecified'}</code><Icon name="arrow" /></button>) : <p className="ex-muted">No supported dependency declarations found.</p>}</div><p className="ex-footnote">Read from manifests; versions are declarations, not installed-package or vulnerability checks.</p></Panel>
    </div></div>
     <div className="ex-workflow-heading"><h2>Explore your codebase</h2><span className="ex-meta">From snapshot to source evidence</span></div><div className="ex-workflows">{([{ title: 'Search Codebase', text: 'Find symbols, imports, and source text. Inspect matching lines in context.', action: 'Open Code Search', page: 'search', icon: 'search' }, { title: 'Analyze an Issue', text: 'Bring an error or stack trace. Trace relevant files and evidence-backed hypotheses.', action: 'Start Issue Assistant', page: 'investigate', icon: 'issue' }, { title: 'Explore Architecture', text: 'Follow import relationships and inspect the repository’s source structure.', action: 'View Architecture', page: 'architecture', icon: 'layers' }] as const).map(item => <section className="ex-workflow" key={item.page}><span className="ex-workflow-icon"><Icon name={item.icon} /></span><h3>{item.title}</h3><p>{item.text}</p><button className="ex-button ex-button-primary" onClick={() => onNavigate(item.page)}>{item.action}<Icon name="arrow" /></button></section>)}</div>{sourceLocation && <SourcePane project={project} location={sourceLocation} onClose={() => setSourceLocation(null)} />}
  </div>
}

function SearchResultGroup({ path, results, active, query, onSelect }: { path: string; results: api.SearchResult[]; active: boolean; query: string; onSelect: (result: api.SearchResult) => void }) {
  return <article className={`ex-result-group ${active ? 'ex-result-active' : ''}`}><button className="ex-result-heading" onClick={() => onSelect(results[0])}><span className={`ex-result-dot ${active ? 'ex-dot-active' : ''}`} /><span className="ex-result-file">{filename(path)}</span><span className="ex-result-count">{results.length} {results.length === 1 ? 'match' : 'matches'}</span><span className="ex-result-language">{results[0].language || 'source'}</span></button><p className="ex-result-path">{path}</p><div className="ex-result-lines">{results.slice(0, 8).map(result => <button key={`${result.path}:${result.line}:${result.text}`} className="ex-result-line" onClick={() => onSelect(result)}><span>L.{result.line}</span><code><Highlight text={result.text.trim() || '(empty line)'} query={query} /></code></button>)}</div>{results.length > 8 && <span className="ex-more">+ {results.length - 8} more matches</span>}</article>
}

export function SearchScreen({ project }: ProjectProps) {
  const [filters, setFilters] = useState<SearchFilters>({ query: '', path: '', language: '', kind: '' })
  const [draft, setDraft] = useState('')
  const [data, setData] = useState<SearchPage | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<api.SearchResult | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const submit = (event?: FormEvent) => { event?.preventDefault(); setOffset(0); setFilters(value => ({ ...value, query: draft.trim() })) }
  useEffect(() => {
    let active = true
    if (!filters.query) { setData(null); setSelected(null); setLoading(false); return }
    setLoading(true); setError('')
    searchPage(project.id, { ...filters, offset, limit: 80, path: filters.path || undefined, language: filters.language || undefined, kind: filters.kind || undefined }).then(value => { if (active) { setData(current => offset === 0 ? value : { ...value, results: [...(current?.results || []), ...value.results] }); if (offset === 0) setSelected(value.results[0] || null) } }).catch(reason => { if (active) setError(errorMessage(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.id, filters, offset, retry])
  const grouped = (data?.results || []).reduce<Record<string, api.SearchResult[]>>((groups, result) => { (groups[result.path] ||= []).push(result); return groups }, {})
  const languages = [...new Set((data?.results || []).map(item => item.language).filter(Boolean) as string[])]
  const select = (result: api.SearchResult) => setSelected(result)
  return <div className="ex-screen ex-search-screen">
    <div className="ex-screen-kicker"><span className="ex-pill"><Icon name="search" />Source search</span><span className="ex-meta">{project.repository_name}</span></div>
    <div className="ex-page-heading"><div><h1>Find source evidence</h1><p>Search functions, hooks, variables, or exact text across the imported snapshot.</p></div></div>
    <form className="ex-search-bar" onSubmit={submit}><Icon name="search" /><input aria-label="Search source" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Search functions, symbols, or natural language intent…" /><button className="ex-button ex-button-primary" type="submit"><Icon name="search" />Search code</button><button className="ex-button" type="button" onClick={() => setShowFilters(value => !value)}><span>Filters</span>{Object.values(filters).filter(Boolean).length > 1 && <span className="ex-filter-badge">{Object.values(filters).filter(Boolean).length - 1}</span>}</button></form>
    {showFilters && <div className="ex-filter-panel"><label>Path contains<input value={filters.path} onChange={event => setFilters(value => ({ ...value, path: event.target.value }))} placeholder="src/ or packages/" /></label><label>Language<select value={filters.language} onChange={event => setFilters(value => ({ ...value, language: event.target.value }))}><option value="">Any language</option>{languages.map(language => <option key={language}>{language}</option>)}{Object.keys(project.languages).filter(language => !languages.includes(language)).map(language => <option key={language}>{language}</option>)}</select></label><label>Kind<select value={filters.kind} onChange={event => setFilters(value => ({ ...value, kind: event.target.value }))}><option value="">Any match kind</option><option value="symbol">Symbol</option><option value="content">Content</option><option value="import">Import</option></select></label><button className="ex-link" type="button" onClick={() => setFilters(value => ({ ...value, path: '', language: '', kind: '' }))}>Clear filters</button></div>}
    <div className="ex-search-status">{filters.query ? <><span className="ex-pill ex-pill-blue">Query: <strong>{filters.query}</strong></span>{filters.path && <span className="ex-pill">Path: {filters.path}</span>}{filters.language && <span className="ex-pill">Language: {filters.language}</span>}<span className="ex-meta">{loading ? 'Searching…' : data ? `${number(data.total_matches)} matches across ${number(data.total_files)} files · ${data.elapsed_ms}ms` : 'Ready to search'}</span></> : <span className="ex-meta">Enter a query to search this repository.</span>}</div>
    {error && <ErrorNotice message={error} retry={() => setRetry(value => value + 1)} />}
    {!filters.query ? <Empty title="Search the imported source">Results are grouped by file, with match lines and an inspector for the selected source context.</Empty> : loading && !data ? <div className="ex-loading" role="status">Searching indexed source…</div> : data && data.results.length === 0 ? <Empty title="No matches found">Try a shorter query or remove a path, language, or kind filter.</Empty> : <div className="ex-search-workbench"><div className="ex-results-pane">{Object.entries(grouped).map(([path, results]) => <SearchResultGroup key={path} path={path} results={results} query={filters.query} active={selected?.path === path} onSelect={select} />)}{data?.has_more && <button className="ex-button ex-load-more" onClick={() => setOffset(value => value + (data.results.length || 80))}>Load more results</button>}</div><SourcePane project={project} location={selected ? { path: selected.path, line: selected.line } : null} query={filters.query} /></div>}
    <footer className="ex-search-footer"><span><Icon name="check" />Index-backed results are from this imported snapshot.</span><span className="ex-meta">Use path filters to narrow large repositories.</span></footer>
  </div>
}

function InvestigationSummary({ investigation, onOpen }: { investigation: api.Investigation; onOpen: (path: string, line?: number) => void }) {
  return <><Panel title="Evidence-backed summary" icon="check"><p className="ex-issue-summary">{investigation.summary || 'No summary was returned. Review the evidence and limitations below.'}</p>{investigation.confirmedEvidence.length > 0 && <div className="ex-evidence-list">{investigation.confirmedEvidence.map((item, index) => <button className="ex-evidence" key={`${item.path}-${item.line}-${index}`} onClick={() => item.path && onOpen(item.path, item.line || undefined)}><span className="ex-evidence-mark">{index + 1}</span><span><strong>{item.kind || 'Evidence'}</strong><small>{item.text}</small>{item.path && <code>{item.path}{item.line ? `:${item.line}` : ''}</code>}</span><Icon name="arrow" /></button>)}</div>}</Panel><Panel title="Relevant files" icon="file"><div className="ex-relevant-list">{investigation.relevantFiles.length ? investigation.relevantFiles.map(file => <div className="ex-relevant" key={file.path}><button className="ex-link" onClick={() => onOpen(file.path)}>{file.path}</button><span>{file.reason || 'Referenced by analysis'}</span>{file.symbols.length > 0 && <small>{file.symbols.length} symbols identified</small>}</div>) : <p className="ex-muted">No relevant files were identified.</p>}</div></Panel></>
}

export function IssueScreen({ project }: ProjectProps) {
  const [input, setInput] = useState('')
  const [errorInput, setErrorInput] = useState('')
  const [stackTrace, setStackTrace] = useState('')
  const [investigation, setInvestigation] = useState<api.Investigation | null>(null)
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistant, setAssistant] = useState<api.AssistantResponse | null>(null)
  const [assistantError, setAssistantError] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<SourceLocation | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reportError, setReportError] = useState('')
  const examples = ['Cannot read properties of null', 'Hydration failed', 'Memory leak in useEffect']
  const analyze = async (event?: FormEvent) => { event?.preventDefault(); if (!input.trim() && !errorInput.trim() && !stackTrace.trim()) return; setLoading(true); setError(''); setSource(null); try { setInvestigation(await api.investigate(project.id, { question: input.trim() || 'Find evidence for the supplied failure.', error_message: errorInput.trim(), stack_trace: stackTrace })) } catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) } }
  const askAssistant = async (event?: FormEvent) => { event?.preventDefault(); if (!assistantQuestion.trim()) return; setAssistantLoading(true); setAssistantError(''); setSource(null); try { setAssistant(await api.askAssistant(project.id, assistantQuestion.trim())) } catch (reason) { setAssistantError(errorMessage(reason)) } finally { setAssistantLoading(false) } }
  const exportReport = async () => { setReporting(true); setReportError(''); try { const result = await api.report(project.id, { question: input.trim(), error_message: errorInput.trim(), stack_trace: stackTrace }); downloadReport(result.markdown, `${project.repository_name}-issue`) } catch (reason) { setReportError(errorMessage(reason)) } finally { setReporting(false) } }
  const openEvidence = (path: string, line?: number) => setSource({ path, line })
    return <div className="ex-screen ex-issue-screen"><div className="ex-screen-kicker"><span className="ex-pill"><span className="ex-dot" />Issue Assistant</span><span className="ex-pill ex-pill-amber">Static analysis · no runtime verification</span></div><div className="ex-page-heading"><div><h1>Investigate an issue</h1><p>Describe a failure and review source evidence, relevant files, and hypotheses from the repository index.</p></div><button className="ex-button" disabled={!investigation || reporting} onClick={exportReport}><Icon name="download" />{reporting ? 'Preparing…' : 'Export report'}</button></div>
      <form className="ex-issue-input" onSubmit={analyze}><div className="ex-issue-input-heading"><span className="ex-icon-tile"><Icon name="issue" /></span><div><h2>What went wrong?</h2><p>Paste an error, stack trace, issue description, or a focused question.</p></div></div><textarea aria-label="Issue description" value={input} onChange={event => setInput(event.target.value)} placeholder="Describe the issue or ask a focused question…" rows={4} /><input className="ex-issue-context-input" aria-label="Error message" value={errorInput} onChange={event => setErrorInput(event.target.value)} placeholder="Error message (optional)" /><textarea className="ex-issue-context-input" aria-label="Stack trace" value={stackTrace} onChange={event => setStackTrace(event.target.value)} placeholder="Stack trace (optional)" rows={3} /><div className="ex-issue-input-footer"><div className="ex-example-list"><span>Try an example:</span>{examples.map(example => <button type="button" key={example} onClick={() => setInput(example)}>{example}</button>)}</div><button className="ex-button ex-button-primary" type="submit" disabled={loading || (!input.trim() && !errorInput.trim() && !stackTrace.trim())}><Icon name={loading ? 'clock' : 'search'} />{loading ? 'Analyzing…' : 'Analyze issue'}</button></div></form>
      <Panel title="Ask RepoPilot AI" icon="search"><p className="ex-description">Ask a repository question in natural language. The assistant retrieves product guidance and source context, then cites the snapshot evidence it used.</p><form className="ex-issue-input" onSubmit={askAssistant}><textarea aria-label="Ask RepoPilot AI" value={assistantQuestion} onChange={event => setAssistantQuestion(event.target.value)} placeholder="How does authentication work in this repository?" rows={4} /><div className="ex-issue-input-footer"><span className="ex-meta">Evidence-first · never executes repository code</span><button className="ex-button ex-button-primary" type="submit" disabled={assistantLoading || !assistantQuestion.trim()}><Icon name={assistantLoading ? 'clock' : 'search'} />{assistantLoading ? 'Thinking…' : 'Ask AI Assistant'}</button></div></form>{assistantError && <ErrorNotice message={assistantError} />}{assistant && <div className="ex-analysis-grid"><div className="ex-analysis-main"><div className="ex-analysis-status"><span className="ex-dot" />Answer from {assistant.provider}</div><p className="ex-issue-summary" style={{ whiteSpace: 'pre-wrap' }}>{assistant.answer}</p>{assistant.citations.length > 0 && <div className="ex-evidence-list">{assistant.citations.map(citation => citation.path ? <button className="ex-evidence" key={citation.id} onClick={() => openEvidence(citation.path as string, citation.lineStart)}><span className="ex-evidence-mark">↗</span><span><strong>{citation.source}</strong><code>{citation.path}{citation.lineStart ? `:${citation.lineStart}` : ''}</code></span><Icon name="arrow" /></button> : <div className="ex-evidence" key={citation.id}><span className="ex-evidence-mark">i</span><span><strong>{citation.source}</strong><code>{citation.id}</code></span></div>)}</div>}</div><div className="ex-analysis-side"><Panel title="Assistant boundaries" icon="clock"><ul className="ex-limitations">{assistant.limitations.map(item => <li key={item}>{item}</li>)}</ul></Panel></div></div>}</Panel>
      {error && <ErrorNotice message={error} />}{reportError && <ErrorNotice message={reportError} />}
    {!investigation && !loading && !error && <div className="ex-analysis-placeholder"><span className="ex-empty-icon"><Icon name="issue" /></span><h2>Analysis appears here</h2><p>RepoPilot will show confirmed source evidence separately from hypotheses and recommended next steps.</p></div>}
    {loading && <div className="ex-loading" role="status">Tracing source evidence…</div>}
    {investigation && <><div className="ex-analysis-status"><span className="ex-dot" />Analysis complete <span className="ex-meta">Static index only · no tests, runtime, git history, or provider/model claims</span></div><div className={`ex-issue-workbench ${source ? 'ex-has-drawer' : ''}`}><div className="ex-issue-results"><div className="ex-analysis-grid"><div className="ex-analysis-main"><InvestigationSummary investigation={investigation} onOpen={openEvidence} /></div><div className="ex-analysis-side"><Panel title="Hypotheses" icon="issue"><div className="ex-hypotheses">{investigation.hypotheses.length ? investigation.hypotheses.map((hypothesis, index) => <article className="ex-hypothesis" key={`${hypothesis.text}-${index}`}><div><span>H{index + 1}</span><b>{hypothesis.confidence}</b></div><p>{hypothesis.text}</p>{hypothesis.evidence.length > 0 && <small>Evidence: {hypothesis.evidence.join(' · ')}</small>}</article>) : <p className="ex-muted">No hypotheses were returned. This is not a failure signal.</p>}</div></Panel><Panel title="Recommended next steps" icon="arrow"><ol className="ex-next-steps">{investigation.recommendedNextSteps.length ? investigation.recommendedNextSteps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>) : <li>Review the cited source lines and reproduce the issue in your own environment.</li>}</ol></Panel><Panel title="Limitations" icon="clock"><ul className="ex-limitations">{(investigation.limitations.length ? investigation.limitations : ['Static analysis does not run the application or tests.', 'Confidence is not a health score or proof of root cause.']).map(item => <li key={item}>{item}</li>)}</ul></Panel></div></div>{source && <SourcePane project={project} location={source} onClose={() => setSource(null)} />}</div></div></>}
  </div>
}
