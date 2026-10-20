export type RouteName = 'landing' | 'login' | 'register' | 'overview' | 'search' | 'investigate' | 'architecture' | 'repositories' | 'settings' | 'not-found'
export type AppRoute = { name: RouteName; filePath?: string }

export function routeForPath(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'landing' }
  if (path === '/login') return { name: 'login' }
  if (path === '/register') return { name: 'register' }
  if (path === '/workspace' || path === '/overview') return { name: 'overview' }
  if (path === '/search') return { name: 'search' }
  if (path === '/investigate') return { name: 'investigate' }
  if (path === '/architecture') return { name: 'architecture' }
  if (path === '/repositories') return { name: 'repositories' }
  if (path === '/settings') return { name: 'settings' }
  if (path.startsWith('/file/')) {
    const encoded = path.slice('/file/'.length)
    try { return { name: 'overview', filePath: decodeURIComponent(encoded) } } catch { return { name: 'not-found' } }
  }
  return { name: 'not-found' }
}

export const pathForRoute = (name: Exclude<RouteName, 'landing' | 'not-found'>) => name === 'overview' ? '/workspace' : `/${name}`
