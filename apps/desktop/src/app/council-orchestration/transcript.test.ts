import type { GatewayEvent } from '@maliang/shared'
import { describe, expect, it } from 'vitest'

import {
  appendTranscriptText,
  createNodeInputEntry,
  setTranscriptFinalText,
  upsertSubagentTranscript,
  upsertToolTranscript
} from './transcript'

function event(type: string, payload: Record<string, unknown>): GatewayEvent {
  return { type, session_id: 'session-1', payload }
}

describe('node transcript reducer', () => {
  it('keeps input and streamed output in chronological order', () => {
    const input = createNodeInputEntry('task', 1)
    const withText = appendTranscriptText(input ? [input] : [], 'text', 'hello', 2)
    const next = appendTranscriptText(withText, 'text', ' world', 3)

    expect(next).toEqual([
      input,
      {
        at: 3,
        id: 'text-2-1',
        kind: 'text',
        text: 'hello world'
      }
    ])
  })

  it('does not duplicate a full completion already assembled from deltas', () => {
    const entries = appendTranscriptText([], 'text', 'done', 1)

    expect(setTranscriptFinalText(entries, 'done', 2)).toEqual(entries)
    expect(setTranscriptFinalText(entries, 'done now', 2).at(-1)).toMatchObject({ text: 'done now' })
  })

  it('upserts a tool start and completion into one activity row', () => {
    const started = upsertToolTranscript([], event('tool.start', { name: 'read_file', tool_id: 'tool-1', context: 'file.md' }), 'running', 1)

    const completed = upsertToolTranscript(
      started,
      event('tool.complete', { name: 'read_file', tool_id: 'tool-1', summary: 'read 12 lines', result_text: 'contents' }),
      'complete',
      2
    )

    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ id: 'tool-1', name: 'read_file', status: 'completed', summary: 'read 12 lines', detail: 'contents' })
  })

  it('keeps subagent progress bounded and updates the same child', () => {
    const queued = upsertSubagentTranscript(
      [],
      event('subagent.spawn_requested', { goal: 'research', subagent_id: 'child-1', status: 'queued' }),
      'subagent.spawn_requested',
      1
    )

    const running = upsertSubagentTranscript(
      queued,
      event('subagent.tool', { subagent_id: 'child-1', tool_name: 'search_files', tool_preview: 'query' }),
      'subagent.tool',
      2
    )

    const completed = upsertSubagentTranscript(
      running,
      event('subagent.complete', { subagent_id: 'child-1', status: 'completed', summary: 'done' }),
      'subagent.complete',
      3
    )

    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ id: 'child-1', status: 'completed', summary: 'done' })
    expect(completed[0]?.kind === 'subagent' ? completed[0].stream.map(item => item.kind) : []).toEqual(['tool', 'summary'])
  })
})
