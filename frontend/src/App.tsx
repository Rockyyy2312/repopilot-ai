import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import * as api from './api'

type Tab = 'overview' | 'search' | 'investigate' | 'architecture'

const icon = (value: string) => <span className="ico" aria-hidden="true">{value}</span>

function App() {
  const [project, setProject] = useState<api.ImportResponse | null>(null)
  const [tree, setTree] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
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

  const run = async (task: () => Promise<void>) => {
    setLoading(true); setError('')
    try { await task() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Something went wrong') } finally { setLoading(false) }
  }

  const loadProject = async (imported: api.ImportResponse) => {
    setProject(imported)
    const response = await api.getTree(imported.id)
    setTree(response.files)
    setTab('overview')
    setSelected('')
    setContent('')
    setResults([])
    setInvestigation(null)
    setGraphData(null)
  }

  const submitUrl = () => url.trim() && run(async () => loadProject(await api.importGithub(url.trim())))
  const upload = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) run(async () => loadProject(await api.importArchive(file))) }

  useEffect(() => {
    if (!project || !selected) return
    void run(async () => setContent((await api.getFile(project.id, selected)).content))
  }, [project, selected])

  const doSearch = () => project && query.trim() && run(async () => { setResults(await api.search(project.id, query.trim())); setTab('search') })
  const doInvestigation = () => project && question.trim() && run(async () => { setInvestigation(await api.investigate(project.id, { question: question.trim(), error_message: errorMessage.trim(), stack_trace: stackTrace })); setTab('investigate') })
  const loadGraph = () => project && run(async () => { setGraphData(await api.graph(project.id)); setTab('architecture') })
  const downloadReport = () => project && run(async () => { const { markdown } = await api.report(project.id); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' })); link.download = `${project.repository_name}-report.md`; link.click(); URL.revokeObjectURL(link.href) })

  return <div className="app min-h-screen">
    <Header project={project} />
    <main className="shell">
      <Sidebar project={project} tab={tab} setTab={setTab} loadGraph={loadGraph} />
      <section className="content">
        <div className="topline"><div><div className="eyebrow">{project ? 'PROJECT ANALYSIS' : 'GET STARTED'}</div><h1>{project ? 'Understand your codebase.' : 'Bring a repository into focus.'}</h1><p className="subtitle">{project ? 'Trace evidence, inspect files, and turn questions into grounded findings.' : 'Import a public GitHub repository or local archive to explore it with evidence.'}</p></div>{project && <button className="outline" onClick={downloadReport}>{icon('↓')} Download report</button>}</div>
        {error && <Alert message={error} clear={() => setError('')} />}
        {!project ? <ImportCard url={url} setUrl={setUrl} submitUrl={submitUrl} upload={upload} loading={loading} /> : <Workspace project={project} tree={tree} selected={selected} setSelected={setSelected} content={content} tab={tab} setTab={setTab} loading={loading} query={query} setQuery={setQuery} doSearch={doSearch} results={results} question={question} setQuestion={setQuestion} doInvestigation={doInvestigation} investigation={investigation} graphData={graphData} />}
      </section>
    </main>
  </div>
}

function Header({ project }: { project: api.ImportResponse | null }) { return <header><div className="brand"><div className="brand-mark">✦</div><div><b>RepoPilot</b><span>AI CODE INTELLIGENCE</span></div></div><div className="header-right"><span className="status-dot" /> API connected {project && <span className="header-repo">/ {project.repository_name}</span>}</div></header> }

function Sidebar({ project, tab, setTab, loadGraph }: { project: api.ImportResponse | null; tab: Tab; setTab: (tab: Tab) => void; loadGraph: () => void }) { return <aside><div className="eyebrow">WORKSPACE</div><div className="workspace"><div className="repo-icon">⌁</div><div><b>{project ? project.repository_name : 'Your workspace'}</b><small>{project ? project.source.url?.replace('https://github.com/', '') || project.source.filename : 'Import a codebase to begin'}</small></div></div><nav>{[['overview', '▦', 'Overview'], ['search', '⌕', 'Code search'], ['investigate', '◈', 'Investigate issue']].map(([value, glyph, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value as Tab)}>{icon(glyph)} {label}</button>)}<button className={tab === 'architecture' ? 'active' : ''} onClick={loadGraph}>{icon('⌬')} Architecture</button></nav><div className="aside-foot"><div className="limit"><b>Evidence-first analysis</b><span>Results link back to source files and lines.</span></div><small>REPOPILOT AI · PHASE 3</small></div></aside> }

function Alert({ message, clear }: { message: string; clear: () => void }) { return <div className="alert" role="alert">{icon('!')}<div><b>Something needs attention</b><span>{message}</span></div><button onClick={clear} aria-label="Dismiss error">×</button></div> }

function ImportCard({ url, setUrl, submitUrl, upload, loading }: { url: string; setUrl: (value: string) => void; submitUrl: () => void; upload: (event: ChangeEvent<HTMLInputElement>) => void; loading: boolean }) { return <div className="import-grid"><div className="card import-main"><div className="card-icon">⌘</div><h2>Import from GitHub</h2><p>Paste a public repository URL. The backend validates, downloads, and analyzes a safe snapshot.</p><div className="url-row"><input aria-label="GitHub repository URL" placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => event.key === 'Enter' && submitUrl()} /><button onClick={submitUrl} disabled={loading || !url.trim()}>{loading ? 'Analyzing…' : 'Import repository'} <span>→</span></button></div><div className="hint">{icon('i')} Public GitHub repositories only · no Git history</div></div><label className="card dropzone"><div className="upload-icon">↥</div><h2>Upload an archive</h2><p>ZIP, TAR, or TAR.GZ · securely inspected in memory</p><span className="button-secondary">Choose file</span><input type="file" accept=".zip,.tar,.tar.gz,.tgz" onChange={upload} /></label><div className="trust"><span>✦</span><b>Grounded by evidence</b><small>Imported code is never executed. Unsupported files are flagged instead of guessed.</small></div></div> }

 function Workspace({ project, tree, selected, setSelected, content, tab, setTab, loading, query, setQuery, doSearch, results, question, setQuestion, doInvestigation, investigation, graphData }: { project: api.ImportResponse; tree: string[]; selected: string; setSelected: (path: string) => void; content: string; tab: Tab; setTab: (tab: Tab) => void; loading: boolean; query: string; setQuery: (value: string) => void; doSearch: () => void; results: api.SearchResult[]; question: string; setQuestion: (value: string) => void; doInvestigation: () => void; investigation: api.Investigation | null; graphData: api.Graph | null }) { return <><div className="tabs">{(['overview', 'search', 'investigate', 'architecture'] as Tab[]).map(value => <button className={tab === value ? 'selected' : ''} onClick={() => setTab(value)} key={value}>{value === 'overview' ? 'Project status' : value[0].toUpperCase() + value.slice(1)}</button>)}</div>{tab === 'overview' && <Overview project={project} tree={tree} selected={selected} setSelected={setSelected} loading={loading} />}{tab === 'search' && <Search query={query} setQuery={setQuery} submit={doSearch} results={results} select={setSelected} loading={loading} />}{tab === 'investigate' && <Investigate question={question} setQuestion={setQuestion} submit={doInvestigation} data={investigation} loading={loading} />}{tab === 'architecture' && <Architecture data={graphData} loading={loading} />}{selected && <FilePreview path={selected} content={content} loading={loading} />}</> }

function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`card ${className}`}>{children}</div> }
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
function Architecture({ data, loading }: { data: api.Graph | null; loading: boolean }) { return <Card className="tool"><ToolHeading glyph="⌬" title="Architecture map" detail="A lightweight import graph derived from source evidence." />{loading ? <div className="empty">Building graph…</div> : data ? <><div className="graph-metrics"><Metric value={String(data.nodes.length)} label="Nodes" /><Metric value={String(data.edges.length)} label="Import edges" /></div>{data.edges.length ? <div className="edge-list">{data.edges.slice(0, 30).map((edge, index) => <div key={index}><code>{edge.from}</code><span>→</span><code>{edge.to}</code>{edge.evidence && <small>line {edge.evidence.line}</small>}</div>)}</div> : <div className="empty">No import relationships were detected.</div>}</> : <div className="empty">Select Architecture to build an evidence-backed graph summary.</div>}</Card> }
function ToolHeading({ glyph, title, detail }: { glyph: string; title: string; detail: string }) { return <div className="tool-title"><div className="tool-symbol">{glyph}</div><div><h2>{title}</h2><p>{detail}</p></div></div> }
function FilePreview({ path, content, loading }: { path: string; content: string; loading: boolean }) { return <Card className="preview"><div className="card-head"><div><div className="eyebrow">SOURCE VIEWER</div><h2>{path}</h2></div><span className="pill">Read-only</span></div>{loading ? <div className="empty">Loading source…</div> : <pre>{content.split('\n').map((line, index) => <div key={index}><span>{String(index + 1).padStart(3, ' ')}</span>{line}</div>)}</pre>}</Card> }

export default App
