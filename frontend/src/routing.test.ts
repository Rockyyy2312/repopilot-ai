import { describe, expect, it } from 'vitest'
import { pathForRoute, routeForPath } from './routing'

describe('application routing', () => {
  it('maps supported URLs to distinct pages', () => {
    expect(routeForPath('/workspace').name).toBe('overview')
    expect(routeForPath('/login').name).toBe('login')
    expect(routeForPath('/register').name).toBe('register')
    expect(routeForPath('/search').name).toBe('search')
    expect(routeForPath('/investigate').name).toBe('investigate')
    expect(routeForPath('/architecture').name).toBe('architecture')
    expect(routeForPath('/repositories').name).toBe('repositories')
    expect(routeForPath('/settings').name).toBe('settings')
  })
  it('supports encoded source file routes and useful not-found behavior', () => {
    expect(routeForPath('/file/src%2Fapp.ts')).toEqual({ name: 'overview', filePath: 'src/app.ts' })
    expect(routeForPath('/missing')).toEqual({ name: 'not-found' })
  })
  it('generates stable navigation paths', () => {
    expect(pathForRoute('overview')).toBe('/workspace')
    expect(pathForRoute('architecture')).toBe('/architecture')
  })
})
