export type FrontendHealth = { status: 'ok'; app: 'repopilot-frontend' }

/** Pure smoke-check payload used by the UI test suite and future runtime probes. */
export const frontendHealth = (): FrontendHealth => ({ status: 'ok', app: 'repopilot-frontend' })
