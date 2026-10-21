import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Background, Controls, MiniMap, ReactFlow, MarkerType, Position, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import * as api from './api'
import { getPreferences, updatePreferences } from './workspaceApi'
import './management-screens.css'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
const number = (value: number) => value.toLocaleString()
function Icon({ name }: { name: string }) { return <span className="mg-icon material-symbols-outlined" aria-hidden="true">{name}</span> }
function Badge({ children, muted = false }: { children: ReactNode; muted?: boolean }) { return <span className={`mg-badge${muted ? ' mg-muted-badge' : ''}`}>{children}</span> }
function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) { return <div className="mg-error" role="alert"><Icon name="error" /><span>{message}</span>{retry && <button className="outline" onClick={retry}>Retry</button>}</div> }
function CardTitle({ icon, title, detail }: { icon: string; title: string; detail?: string }) { return <div className="mg-card-title"><span className="mg-feature-icon"><Icon name={icon} /></span><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div></div> }

export type ArchitectureScreenProps = { project: api.ImportResponse }
export function ArchitectureScreen({ project }: ArchitectureScreenProps) {
  const [graph, setGraph] = useState<api.Graph | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState<'diagram' | 'relationships'>('diagram')
  const [layout, setLayout] = useState<'layered' | 'radial'>('layered')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [serverScope, setServerScope] = useState('')
  const [showExternal, setShowExternal] = useState(true)
  const [isolated, setIsolated] = useState(false)
  const [source, setSource] = useState<{ content?: string; error?: string; loading?: boolean }>({})
  const [sourceAttempt, setSourceAttempt] = useState(0)
  useEffect(() => {
    setScope('all'); setServerScope(''); setQuery(''); setIsolated(false)
  }, [project.id, attempt])
  useEffect(() => {
    let active = true
    setGraph(null); setError(''); setSelected('')
     api.graph(project.id, { scope: serverScope || undefined, limit: 2000 }).then(result => { if (active) { setGraph(result); setSelected(result.nodes.find(node => node.type !== 'external')?.id || result.nodes[0]?.id || '') } }).catch(reason => { if (active) setError(errorMessage(reason)) })
    return () => { active = false }
   }, [project.id, attempt, serverScope])
  const filePaths = useMemo(() => new Set(project.analysis.files.map(file => file.path)), [project])
  const selectedFile = project.analysis.files.find(file => file.path === selected)
  const selectedNode = graph?.nodes.find(node => node.id === selected)
  const isFile = filePaths.has(selected) && selectedNode?.type !== 'external'
  useEffect(() => {
    let active = true
    setSource({})
    if (selected && isFile) {
      setSource({ loading: true })
      api.getFile(project.id, selected).then(result => { if (active) setSource({ content: result.content }) }).catch(reason => { if (active) setSource({ error: errorMessage(reason) }) })
    }
    return () => { active = false }
  }, [project.id, selected, isFile, sourceAttempt])
  const inbound = graph?.edges.filter(edge => edge.to === selected) || []
  const outbound = graph?.edges.filter(edge => edge.from === selected) || []
  const groups = useMemo(() => [...new Set(graph?.nodes.filter(node => node.type !== 'external').map(node => node.id.includes('/') ? node.id.split('/')[0] : '(root)') || [])].sort(), [graph])
  const visible = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[], relationships: [] as api.Graph['edges'] }
    const neighbors = new Set([selected, ...graph.edges.filter(edge => edge.from === selected || edge.to === selected).flatMap(edge => [edge.from, edge.to])])
    const filtered = graph.nodes.filter(node => (showExternal || node.type !== 'external') && (!isolated || neighbors.has(node.id)) && (scope === 'all' || (node.id.includes('/') ? node.id.split('/')[0] : '(root)') === scope) && node.id.toLowerCase().includes(query.toLowerCase()))
    const ids = new Set(filtered.map(node => node.id))
    const rowsByGroup = new Map<string, number>()
    const columns = [...new Set(filtered.map(node => node.type === 'external' ? 'Unresolved' : node.id.includes('/') ? node.id.split('/')[0] : '(root)'))]
    const nodes: Node[] = filtered.map((node, index) => {
      const external = node.type === 'external'
      const group = external ? 'Unresolved' : node.id.includes('/') ? node.id.split('/')[0] : '(root)'
      const row = rowsByGroup.get(group) || 0; rowsByGroup.set(group, row + 1)
      const angle = index / Math.max(filtered.length, 1) * Math.PI * 2
      const radius = Math.max(300, filtered.length * 34)
      return { id: node.id, position: layout === 'radial' ? { x: Math.cos(angle) * radius + radius, y: Math.sin(angle) * radius + radius } : { x: columns.indexOf(group) * 285, y: row * 150 + (columns.indexOf(group) % 2) * 55 }, selected: node.id === selected, sourcePosition: Position.Right, targetPosition: Position.Left, className: external ? 'mg-graph-node mg-external-node' : 'mg-graph-node', data: { label: <div className="mg-node-content"><div className="mg-node-top"><Icon name={external ? 'link_off' : 'description'} /><span>{external ? 'UNRESOLVED IMPORT' : group}</span></div><strong>{node.id.split('/').pop()}</strong><code>{node.id}</code><div className="mg-node-foot">{external ? 'External or not resolved' : `${graph.edges.filter(edge => edge.to === node.id).length} inbound · ${graph.edges.filter(edge => edge.from === node.id).length} outbound`}</div></div> } }
    })
    const relationships = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))
    const edges: Edge[] = relationships.map((edge, index) => ({ id: `${edge.from}-${edge.to}-${index}`, source: edge.from, target: edge.to, markerEnd: { type: MarkerType.ArrowClosed, color: edge.evidence?.resolved ? '#00855d' : '#8b94a5' }, style: { stroke: edge.evidence?.resolved ? '#00855d' : '#8b94a5', strokeWidth: 1.6, strokeDasharray: edge.evidence?.resolved ? undefined : '5 5' }, label: edge.evidence?.line ? `L${edge.evidence.line}` : undefined }))
    return { nodes, edges, relationships }
  }, [graph, selected, layout, query, scope, isolated, showExternal])
  const exportGraph = () => {
    if (!graph) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ project_id: project.id, repository_name: project.repository_name, ...graph }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'repopilot-architecture.json'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="mg-screen mg-architecture">
    <div className="mg-workbench-bar card"><div className="mg-workbench-context"><span>{project.repository_name}</span><span className="mg-divider">/</span><h1>Architecture Canvas</h1><Badge>{graph ? `${number(graph.nodes.length)} nodes mapped` : 'Loading snapshot'}</Badge></div><div className="mg-actions"><div className="mg-segmented" aria-label="Graph layout"><button aria-pressed={layout === 'layered'} onClick={() => setLayout('layered')}>Layered Stack</button><button aria-pressed={layout === 'radial'} onClick={() => setLayout('radial')}>Radial Flow</button></div><button className="primary" disabled={!graph} onClick={exportGraph}><Icon name="account_tree" />Export Graph</button></div></div>
    {error && <ErrorNotice message={error} retry={() => setAttempt(value => value + 1)} />}
    <div className="mg-architecture-grid"><div className="mg-stack">
      <section className="mg-canvas-card card" aria-label="Architecture graph">
        <div className="mg-canvas-toolbar"><div className="mg-segmented" role="tablist" aria-label="Architecture view"><button role="tab" aria-selected={tab === 'diagram'} onClick={() => setTab('diagram')}><Icon name="account_tree" />Diagram</button><button role="tab" aria-selected={tab === 'relationships'} onClick={() => setTab('relationships')}><Icon name="list" />Relationships</button></div><Badge muted>Static import graph</Badge></div>
         <div className="mg-graph-filters"><input aria-label="Filter graph nodes" placeholder="Filter nodes…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Directory scope" value={scope} onChange={event => { setScope(event.target.value); setServerScope(event.target.value === 'all' ? '' : event.target.value) }}><option value="all">All directories</option>{groups.map(group => <option key={group}>{group}</option>)}</select><label><input type="checkbox" checked={showExternal} onChange={event => setShowExternal(event.target.checked)} />Unresolved imports</label>{isolated && <button className="mg-text-button" onClick={() => setIsolated(false)}>Clear isolation</button>}</div>
        {!graph ? <div className="mg-canvas-empty" role="status">{error ? 'Graph could not be loaded.' : 'Mapping repository imports…'}</div> : visible.nodes.length === 0 ? <div className="mg-canvas-empty">No nodes match these filters.</div> : tab === 'diagram' ? <div className="mg-flow"><ReactFlow key={`${project.id}-${layout}-${scope}-${isolated}`} nodes={visible.nodes} edges={visible.edges} onNodeClick={(_, node) => setSelected(node.id)} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.05} maxZoom={2} nodesDraggable={false} nodesConnectable={false}><Background color="#bccac0" gap={28} size={1.2} /><MiniMap pannable zoomable nodeColor={node => node.selected ? '#00855d' : '#cce5ff'} /><Controls showInteractive={false} /></ReactFlow></div> : <div className="mg-relationship-table" role="tabpanel"><table><thead><tr><th>Importing file</th><th>Target</th><th>Evidence</th></tr></thead><tbody>{visible.relationships.map((edge, index) => <tr key={`${edge.from}-${index}`}><td><button onClick={() => setSelected(edge.from)}>{edge.from}</button></td><td><button onClick={() => setSelected(edge.to)}>{edge.to}</button></td><td>{edge.evidence?.resolved ? 'Resolved import' : 'Unresolved import'}{edge.evidence?.line ? ` · L${edge.evidence.line}` : ''}</td></tr>)}</tbody></table>{!visible.relationships.length && <p className="mg-empty">No import relationships in this scope.</p>}</div>}
        <div className="mg-canvas-footer"><span><i />Resolved import</span><span><i className="mg-dashed" />Unresolved import</span><span>Click a node to inspect its source</span></div>
      </section>
       <div className="mg-graph-stats card"><div><strong>{number(visible.nodes.length)}</strong><span>Visible nodes / {graph?.truncated?.total_nodes || graph?.nodes.length || 0}</span></div><div><strong>{number(visible.edges.length)}</strong><span>Visible relationships / {graph?.truncated?.total_edges || graph?.edges.length || 0}</span></div><div><strong>{number(graph?.edges.filter(edge => edge.evidence?.resolved === false).length || 0)}</strong><span>Unresolved imports</span></div>{graph?.truncated && <div className="mg-truncation"><strong>Bounded view</strong><span>{graph.truncated.nodes || graph.truncated.edges ? 'Use directory scope to narrow the graph.' : 'Full graph within the current limit.'}</span></div>}</div>
      <div className="mg-evidence-note"><Icon name="info" /><div>Derived from the imported source snapshot. Import relationships do not establish runtime calls or change impact.{graph?.limitations?.map((limitation, index) => <p key={index}>{limitation}</p>)}</div></div>
    </div><div className="mg-stack mg-inspector" aria-label="Node inspector">
      <section className="card mg-panel"><Badge>Selected node</Badge><h2 className="mg-inspector-name">{selected ? selected.split('/').pop() : 'Node inspector'}</h2><code className="mg-path">{selected || 'Select a node to explore its dependencies.'}</code>{selected && <><div className="mg-inspector-metrics"><div><span>Inbound imports</span><strong>{inbound.length}</strong><div className="mg-meter"><span style={{ width: `${inbound.length ? Math.max(5, inbound.length / Math.max(graph?.edges.length || 1, 1) * 100) : 0}%` }} /></div></div><div><span>Outbound imports</span><strong>{outbound.length}</strong><div className="mg-meter mg-blue-meter"><span style={{ width: `${outbound.length ? Math.max(5, outbound.length / Math.max(graph?.edges.length || 1, 1) * 100) : 0}%` }} /></div></div></div><div className="mg-node-facts"><span>Node type</span><b>{isFile ? 'Repository file' : 'Unresolved / external'}</b>{selectedFile && <><span>Language</span><b>{selectedFile.language || 'Unclassified'}</b><span>Indexed symbols</span><b>{selectedFile.symbols.length}</b></>}</div><button className="outline mg-full" onClick={() => setIsolated(value => !value)}><Icon name="hub" />{isolated ? 'Show full graph' : 'Isolate immediate neighbors'}</button></>}</section>
      <section className="card mg-panel"><CardTitle icon="code" title="Source Preview" detail={isFile ? 'Source from this imported snapshot' : 'Select a repository file to preview source'} />{!isFile ? <p className="mg-empty">{selected ? 'This import has no resolved repository file. It may be external or unsupported by static resolution.' : 'No file selected.'}</p> : source.loading ? <p role="status">Loading source…</p> : source.error ? <ErrorNotice message={source.error} retry={() => setSourceAttempt(value => value + 1)} /> : source.content !== undefined ? <><pre className="mg-source"><code>{source.content.split('\n').slice(0, 160).map((line, index) => <span className="mg-source-line" key={index}><span>{index + 1}</span>{line || ' '}{'\n'}</span>)}</code></pre>{source.content.split('\n').length > 160 && <p className="mg-small">Showing the first 160 lines.</p>}</> : null}</section>
      <section className="card mg-panel"><CardTitle icon="alt_route" title="Direct Dependencies" detail="Inspect the evidence behind each connection" /><div className="mg-dependencies">{[...inbound.map(edge => ({ edge, path: edge.from, direction: 'Inbound' })), ...outbound.map(edge => ({ edge, path: edge.to, direction: 'Outbound' }))].map(({ edge, path, direction }, index) => <button key={`${path}-${index}`} onClick={() => setSelected(path)}><span><b>{path}</b><small>{direction} · {edge.evidence?.resolved ? 'Resolved import' : 'Unresolved import'}{edge.evidence?.line ? ` · line ${edge.evidence.line}` : ''}</small></span><Icon name="chevron_right" /></button>)}{inbound.length + outbound.length === 0 && <p className="mg-small">No direct imports recorded for this node.</p>}</div></section>
    </div></div>
  </div>
}

export type RepositoriesScreenProps = { projects: api.ProjectSummary[]; selectedId: string; onSelect: (id: string) => void; onImported: (project: api.ImportResponse) => void; onDeleted: (id: string) => void }
export function RepositoriesScreen({ projects, selectedId, onSelect, onImported, onDeleted }: RepositoriesScreenProps) {
  const [url, setUrl] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [retryInput, setRetryInput] = useState<File | string | null>(null)
  const [jobId, setJobId] = useState('')
  const [deleting, setDeleting] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const importSource = async (input: File | string) => {
    if (lock.current) return
    setError(''); setStatus(''); setRetryInput(null)
    let source = input
    if (typeof source === 'string') {
      source = source.trim()
      if (/^[\w.-]+\/[\w.-]+$/.test(source)) source = `https://github.com/${source}`
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(source)) { setError('Enter a valid public GitHub repository URL (https://github.com/owner/repo).'); return }
    } else if (source.size > 25 * 1024 * 1024) { setError('Archive exceeds the 25 MiB upload limit.'); return }
    else if (!/\.(zip|tar|tar\.gz|tgz)$/i.test(source.name)) { setError('Choose a .zip, .tar, .tar.gz, or .tgz archive.'); return }
    lock.current = true; setBusy(true); setRetryInput(source)
    setStatus(typeof source === 'string' ? 'Fetching public repository and indexing source…' : `Uploading ${source.name} and indexing source…`)
    try {
      const job = await (typeof source === 'string' ? api.startImportJobGithub(source) : api.startImportJobArchive(source))
      setJobId(job.id)
      let current = job
      while (current.status === 'queued' || current.status === 'running') {
        await new Promise(resolve => window.setTimeout(resolve, 250))
        current = await api.getJob(job.id)
        setStatus(`${current.message || 'Indexing repository…'} ${Math.round(current.progress * 100)}%`)
      }
      if (current.status === 'cancelled') throw new Error('Repository import was cancelled.')
      if (current.status !== 'succeeded' || !current.result) throw new Error(current.error || 'Repository import failed.')
      const result = api.normalizeImport(current.result)
      onImported(result); setStatus(`Imported ${result.repository_name}: ${number(result.file_count)} files indexed.`); setUrl(''); setRetryInput(null)
    }
    catch (reason) { setError(errorMessage(reason)); setStatus('') }
    finally { setJobId(''); lock.current = false; setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const remove = async (project: api.ProjectSummary) => {
    if (!window.confirm(`Delete the imported snapshot of ${project.repository_name}? The original repository will not be changed.`)) return
    setDeleting(project.id); setDeleteError('')
    try { await api.deleteProject(project.id); onDeleted(project.id) } catch (reason) { setDeleteError(errorMessage(reason)) } finally { setDeleting('') }
  }
  const filtered = projects.filter(project => `${project.repository_name} ${Object.keys(project.languages).join(' ')} ${project.source.url || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="mg-screen mg-repositories">
    <div className="mg-page-heading"><div><span className="mg-eyebrow">Workspace Engine</span><h1>Repository Management</h1><p>Connect a public repository or upload source code. Explore indexed files, symbols, and import relationships in one workspace.</p></div><Badge muted><Icon name="storage" />Indexed Repos: <strong>{projects.length}</strong></Badge></div>
    <div className="mg-import-grid"><section className="card mg-import-card"><CardTitle icon="hub" title="Connect Remote Provider" detail="Import the default branch of a public GitHub repository." /><div className="mg-provider-tabs"><button aria-pressed="true" onClick={() => document.getElementById('mg-repository-url')?.focus()}><Icon name="code" />GitHub</button><button disabled title="GitLab import is not supported">GitLab <span>Unavailable</span></button><button disabled title="Generic Git import is not supported">Generic Git <span>Unavailable</span></button></div><form onSubmit={(event: FormEvent) => { event.preventDefault(); void importSource(url) }}><label className="mg-field" htmlFor="mg-repository-url">Repository URL or Slug<input id="mg-repository-url" aria-label="GitHub repository URL" placeholder="https://github.com/org/repo or owner/repo" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} /></label><div className="mg-import-details"><span><Icon name="public" />Public repositories only</span><span><Icon name="account_tree" />Static source indexing</span></div><div className="mg-import-footer"><span className="mg-small">No provider account connection required</span><button className="primary" disabled={busy} type="submit"><Icon name="add_circle" />{busy ? 'Importing…' : 'Import repository'}</button></div></form></section>
    <section className="card mg-import-card"><CardTitle icon="folder_zip" title="Upload Local Source" detail="Import a compressed project snapshot." /><div className={`mg-drop-zone${dragging ? ' mg-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (busy) return; if (event.dataTransfer.files.length !== 1) { setError('Drop one source archive at a time.'); return }; void importSource(event.dataTransfer.files[0]) }}><span className="mg-upload-icon"><Icon name="cloud_upload" /></span><strong>Drag & drop an archive here</strong><p>.zip, .tar, .tar.gz, or .tgz · up to 25 MiB</p><input ref={fileInput} className="mg-hidden-file" type="file" accept=".zip,.tar,.tar.gz,.tgz" aria-label="Upload source archive" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void importSource(file) }} /><button className="outline" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="folder_open" />Browse Files</button></div><div className="mg-import-details"><span><Icon name="lock" />Source is never executed</span><span>25 MiB maximum</span></div></section></div>
     {busy && <div className="mg-import-progress" role="status"><progress aria-label="Import in progress" value={jobId ? undefined : 0} /><span>{status}</span>{jobId && <button className="outline" onClick={() => { void api.cancelJob(jobId).catch(reason => setError(errorMessage(reason))) }}>Cancel import</button>}<small>Import work runs in a bounded local worker; you can leave this screen open while it completes.</small></div>}{!busy && status && <div className="mg-success" role="status"><Icon name="check_circle" />{status}</div>}{error && <ErrorNotice message={error} retry={retryInput && !busy ? () => void importSource(retryInput) : undefined} />}
     <div className="mg-metric-ribbon">{[{ icon: 'code_blocks', label: 'Total Files Indexed', value: projects.reduce((sum, project) => sum + project.file_count, 0), detail: 'Across imported snapshots' }, { icon: 'account_tree', label: 'Symbols Indexed', value: projects.reduce((sum, project) => sum + project.symbol_count, 0), detail: 'Detected source definitions' }, { icon: 'link', label: 'Imports Recorded', value: projects.reduce((sum, project) => sum + project.import_count, 0), detail: 'Static import statements' }].map(metric => <div className="card mg-metric" key={metric.label}><span className="mg-feature-icon"><Icon name={metric.icon} /></span><div><span>{metric.label}</span><strong>{number(metric.value)}</strong><small>{metric.detail}</small></div></div>)}</div>
    <div className="mg-list-heading"><h2>Your Imported Repositories <Badge muted>{projects.length} snapshots</Badge></h2><input aria-label="Filter repositories" placeholder="Filter repositories…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    {deleteError && <ErrorNotice message={deleteError} />}
     <div className="mg-repository-grid">{filtered.map(project => <section className={`card mg-repository-card${project.id === selectedId ? ' mg-selected-repository' : ''}`} key={project.id}><div className="mg-repository-heading"><span className="mg-feature-icon"><Icon name="deployed_code" /></span><div><h3>{project.repository_name}</h3><span className="mg-small">{project.source.type === 'github' ? 'GitHub snapshot' : 'Uploaded archive'}</span></div><Badge>{project.id === selectedId ? 'Selected' : 'Indexed'}</Badge></div><p className="mg-repository-source">{project.source.url || project.source.filename || 'Imported source snapshot'}</p><div className="mg-language-list">{Object.keys(project.languages).map(language => <span key={language}>{language}</span>)}{!Object.keys(project.languages).length && <span>Unclassified source</span>}</div><dl className="mg-repository-facts"><div><dt>Source files</dt><dd>{number(project.file_count)}</dd></div><div><dt>Symbols / imports</dt><dd>{number(project.symbol_count)} / {number(project.import_count)}</dd></div><div><dt>Import warnings</dt><dd>{number(project.warning_count)}</dd></div></dl><div className="mg-repository-actions"><button className="primary" onClick={() => onSelect(project.id)}><Icon name="folder_open" />Open</button><button className="mg-delete-button" disabled={!!deleting} aria-label={`Delete ${project.repository_name}`} onClick={() => void remove(project)}><Icon name="delete" />{deleting === project.id ? 'Deleting…' : 'Delete'}</button></div></section>)}</div>
    {!filtered.length && <div className="card mg-empty"><Icon name="folder_open" /><h3>{projects.length ? 'No matching repositories' : 'Your workspace starts here'}</h3><p>{projects.length ? 'Try another repository name or language.' : 'Import a public GitHub repository or drop an archive above to start exploring.'}</p></div>}
    <div className="mg-help-banner"><span className="mg-feature-icon"><Icon name="lightbulb" /></span><div><strong>Working with private source?</strong><p>Upload an archive you have access to. Imports are snapshots; re-import to analyze updated source. Git provider OAuth and automatic synchronization are not configured.</p></div></div>
  </div>
}

type Preferences = { display_name: string; reduced_motion: boolean; compact_mode: boolean }
export type SettingsScreenProps = { user: api.AuthUser; project: api.ImportResponse | null; onDeleted: (id: string) => void; onPreferencesChanged: (prefs: { reduced_motion: boolean; compact_mode: boolean }) => void }
export function SettingsScreen({ user, project, onDeleted, onPreferencesChanged }: SettingsScreenProps) {
  const [tab, setTab] = useState<'profile' | 'connections' | 'data'>('profile')
  const [saved, setSaved] = useState<Preferences | null>(null)
  const [draft, setDraft] = useState<Preferences>({ display_name: '', reduced_motion: false, compact_mode: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const preferencesChanged = useRef(onPreferencesChanged)
  preferencesChanged.current = onPreferencesChanged
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setStatus(''); setSaved(null)
    getPreferences().then(result => { if (active) { setSaved(result); setDraft(result); preferencesChanged.current(result) } }).catch(reason => { if (active) setError(errorMessage(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user.id, attempt])
  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft)
  const save = async () => {
    setSaving(true); setError(''); setStatus('')
    try { await updatePreferences(draft); const persisted = await getPreferences(); setSaved(persisted); setDraft(persisted); preferencesChanged.current(persisted); setStatus('Settings saved and verified.') } catch (reason) { setError(errorMessage(reason)) } finally { setSaving(false) }
  }
  const deleteSnapshot = async () => {
    if (!project || !window.confirm(`Permanently delete the imported snapshot of ${project.repository_name}? This removes its stored source and analysis.`)) return
    setDeleting(true); setDeleteError('')
    try { await api.deleteProject(project.id); onDeleted(project.id); setStatus('Repository snapshot deleted.') } catch (reason) { setDeleteError(errorMessage(reason)) } finally { setDeleting(false) }
  }
  const connectionPanel = <section className="card mg-panel"><CardTitle icon="source_notes" title="Git Provider Capabilities" detail="Available import methods in this workspace" /><div className="mg-connection"><span className="mg-provider-logo"><Icon name="code" /></span><div><strong>GitHub</strong><small>Public repository URL import</small></div><Badge>Available</Badge></div><div className="mg-connection"><span className="mg-provider-logo mg-provider-unavailable"><Icon name="merge" /></span><div><strong>GitLab & other providers</strong><small>No provider connection configured</small></div><Badge muted>Unavailable</Badge></div><p className="mg-small">No OAuth account is connected. Private source can be imported as an archive from Repositories. Automatic sync and webhook notifications are not available.</p></section>
  return <div className="mg-screen mg-settings">
    <div className="mg-page-heading"><div><span className="mg-eyebrow"><Icon name="tune" />Configuration Hub</span><h1>Account & Workspace Settings</h1><p>Manage your developer profile, source import capabilities, and appearance preferences.</p></div><Badge muted><Icon name="person" />Personal workspace</Badge></div>
    <div className="mg-settings-tabs" role="tablist" aria-label="Settings sections">{([{ id: 'profile', icon: 'manage_accounts', title: 'Profile & Preferences' }, { id: 'connections', icon: 'hub', title: 'Connections' }, { id: 'data', icon: 'database', title: 'Data & Storage' }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} aria-controls={`mg-settings-${item.id}`} onClick={() => setTab(item.id)}><Icon name={item.icon} />{item.title}</button>)}</div>
    {error && <ErrorNotice message={error} retry={() => saved ? void save() : setAttempt(value => value + 1)} />}{status && <div className="mg-success" role="status"><Icon name="check_circle" />{status}</div>}
    {tab === 'profile' && <div id="mg-settings-profile" role="tabpanel" className="mg-settings-grid"><div className="mg-stack"><section className="card mg-panel mg-profile-card"><CardTitle icon="badge" title="User Profile" /><div className="mg-profile-summary"><span className="mg-avatar">{(saved?.display_name || user.email).slice(0, 2).toUpperCase()}</span><div><strong>{saved?.display_name || 'Your developer profile'}</strong><p>{user.email}</p><span className="mg-small">Preferences are saved to your account.</span></div></div><div className="mg-profile-fields"><label className="mg-field">Display Name<input value={draft.display_name} maxLength={80} disabled={loading || saving || !saved} placeholder="Your name" onChange={event => { setDraft({ ...draft, display_name: event.target.value }); setStatus('') }} /></label><label className="mg-field">Email Address<input value={user.email} readOnly /><small>Your sign-in email is read-only.</small></label></div><div className="mg-profile-note"><Icon name="lock" />Changes apply to this signed-in account, across repository snapshots.</div></section><section className="card mg-panel"><CardTitle icon="accessibility_new" title="Interaction Preferences" detail="Make the workspace comfortable to navigate" /><label className="mg-toggle-row"><span className="mg-feature-icon"><Icon name="motion_photos_off" /></span><span><strong>Reduce interface motion</strong><small>Minimize decorative animations and transitions.</small></span><input role="switch" type="checkbox" checked={draft.reduced_motion} disabled={loading || saving || !saved} onChange={event => { setDraft({ ...draft, reduced_motion: event.target.checked }); setStatus('') }} /></label><label className="mg-toggle-row mg-compact-setting"><span className="mg-feature-icon"><Icon name="density_small" /></span><span><strong>Compact workspace density</strong><small>Reduce spacing across repository panels and workspace views.</small></span><input role="switch" aria-label="Compact workspace density" type="checkbox" checked={draft.compact_mode} disabled={loading || saving || !saved} onChange={event => { const compact_mode = event.target.checked; setDraft({ ...draft, compact_mode }); preferencesChanged.current({ ...draft, compact_mode }); setStatus('') }} /></label></section></div><div className="mg-stack"><section className="card mg-panel"><CardTitle icon="palette" title="Appearance & Layout" /><div className="mg-theme-preview"><div className="mg-row"><strong>Clarity Light</strong><Badge>Active theme</Badge></div><div className="mg-theme-mini" aria-hidden="true"><div /><div><i /><i /><span /><span /></div></div><span className="mg-small">A clear canvas for source exploration</span></div><label className="mg-field">Dashboard Density</label><div className="mg-segmented mg-density"><button disabled={loading || saving || !saved} aria-pressed={!draft.compact_mode} onClick={() => { setDraft({ ...draft, compact_mode: false }); preferencesChanged.current({ ...draft, compact_mode: false }); setStatus('') }}>Comfortable</button><button disabled={loading || saving || !saved} aria-pressed={draft.compact_mode} onClick={() => { setDraft({ ...draft, compact_mode: true }); preferencesChanged.current({ ...draft, compact_mode: true }); setStatus('') }}>Compact</button></div><p className="mg-small">Compact mode reduces spacing for denser workspace views.</p></section>{connectionPanel}</div></div>}
    {tab === 'connections' && <div id="mg-settings-connections" role="tabpanel" className="mg-settings-grid">{connectionPanel}<section className="card mg-panel"><CardTitle icon="folder_zip" title="Local Source Archives" detail="Import source without a provider integration" /><p>Upload .zip, .tar, .tar.gz, or .tgz archives up to 25 MiB from the Repositories screen.</p><div className="mg-evidence-note"><Icon name="info" />Imports retain a source snapshot. Repository code is analyzed statically and is never executed.</div></section></div>}
    {tab === 'data' && <div id="mg-settings-data" role="tabpanel" className="mg-settings-grid"><section className="card mg-panel"><CardTitle icon="storage" title="Workspace Data" detail="Source and analysis for the selected repository" />{project ? <><h3>{project.repository_name}</h3><dl className="mg-repository-facts"><div><dt>Files stored</dt><dd>{number(project.file_count)}</dd></div><div><dt>Symbols indexed</dt><dd>{number(project.symbol_count)}</dd></div><div><dt>Recorded imports</dt><dd>{number(project.import_count)}</dd></div></dl></> : <p>No repository selected. Account preferences remain available without an imported project.</p>}</section><section className="card mg-panel mg-danger-panel"><CardTitle icon="delete_forever" title="Delete Repository Snapshot" detail="Permanently remove imported source and analysis" /><p>The original remote repository or local archive will not be changed. Choose a repository to manage its stored snapshot.</p><button className="mg-danger-action" disabled={!project || deleting} onClick={() => void deleteSnapshot()}>{deleting ? 'Deleting…' : 'Delete selected repository'}</button>{deleteError && <ErrorNotice message={deleteError} />}</section></div>}
    <div className="card mg-save-bar"><span><Icon name="info" />{loading ? 'Loading saved preferences…' : dirty ? 'You have unsaved profile or appearance changes.' : 'Profile and appearance preferences are saved per account.'}</span><div className="mg-actions"><button className="outline" disabled={!dirty || saving} onClick={() => { if (saved) setDraft(saved); setStatus(''); setError('') }}>Cancel</button><button className="primary" disabled={!dirty || saving || loading} onClick={() => void save()}><Icon name="check" />{saving ? 'Saving…' : 'Save Changes'}</button></div></div>
  </div>
}
