import { describe, expect, it } from 'vitest'

import { appViewForPath, COUNCIL_ROUTE, routeSessionId } from './routes'

describe('council route', () => {
  it('resolves to the council view instead of a stored chat session', () => {
    expect(appViewForPath(COUNCIL_ROUTE)).toBe('council')
    expect(routeSessionId(COUNCIL_ROUTE)).toBeNull()
  })
})
