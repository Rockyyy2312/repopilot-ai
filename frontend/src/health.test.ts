import { describe, expect, it } from 'vitest'
import { frontendHealth } from './health'

describe('frontend health', () => {
  it('returns a stable healthy payload', () => {
    expect(frontendHealth()).toEqual({ status: 'ok', app: 'repopilot-frontend' })
  })
})
