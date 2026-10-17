export type SearchResult={path:string;line:number;text:string}; export type Tree={project_id:string;files:string[]};
const base='/api/v1';
async function request<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(base+url,init);if(!r.ok){const body=await r.json().catch(()=>null);throw new Error(body?.detail||`Request failed (${r.status})`)}return r.json()}
export const normalizeSearch=(data:unknown):SearchResult[]=>{if(!data||typeof data!=='object'||!Array.isArray((data as {results?:unknown}).results))return[];return (data as {results:SearchResult[]}).results.filter(x=>x&&typeof x.path==='string'&&typeof x.line==='number')};
export const importGithub=(url:string)=>request<{id:string;source:{url:string};files:string[]}>('/projects/import/github',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
export const importArchive=(file:File)=>{const form=new FormData();form.append('file',file);return request<{id:string;file_count:number}>('/projects/import/archive',{method:'POST',body:form})};
export const getTree=(id:string)=>request<Tree>(`/projects/${id}/tree`); export const getFile=(id:string,path:string)=>request<{path:string;content:string}>(`/projects/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`);
export const search=(id:string,q:string)=>request<unknown>(`/projects/${id}/search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q,limit:50})}).then(normalizeSearch);
export const investigate=(id:string,question:string)=>request<{findings:Array<Record<string,unknown>>;hypotheses:Array<Record<string,unknown>>}>(`/projects/${id}/investigate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question})});
export const graph=(id:string)=>request<{nodes:Array<{id:string}>;edges:Array<{from:string;to:string}>}>(`/projects/${id}/graph`); export const report=(id:string)=>request<{markdown:string}>(`/projects/${id}/report`);
