import type { GatewayEvent } from '@maliang/shared'

import type {
  NodeSubagentStatus,
  NodeSubagentStreamEntry,
  NodeToolStatus,
  NodeTranscriptEntry,
  NodeTranscriptStatus,
  NodeTranscriptSubagentEntry,
  NodeTranscriptTextEntry,
  NodeTranscriptToolEntry
} from './types'

const MAX_SUBAGENT_STREAM = 24
const MAX_TOOL_DETAIL = 16_000

type EventPayload = Record<string, unknown>

function payloadRecord(eventOrPayload: GatewayEvent | unknown): EventPayload {
  const value = 'payload' in Object(eventOrPayload) ? (eventOrPayload as GatewayEvent).payload : eventOrPayload

  return value && typeof value === 'object' && !Array.isArray(value) ? (value as EventPayload) : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function textValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return ''
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function bounded(value: string): string {
  return value.length > MAX_TOOL_DETAIL ? `${value.slice(0, MAX_TOOL_DETAIL)}\n[内容已截断]` : value
}

function idFor(kind: string, at: number, entries: readonly NodeTranscriptEntry[]): string {
  return `${kind}-${at}-${entries.length}`
}

function textEntry(
  entries: readonly NodeTranscriptEntry[],
  kind: NodeTranscriptTextEntry['kind'],
  text: string,
  at: number,
  status?: NodeTranscriptStatus
): NodeTranscriptTextEntry {
  return { at, id: idFor(kind, at, entries), kind, ...(status ? { status } : {}), text }
}

export function createNodeInputEntry(text: string, at = Date.now()): NodeTranscriptTextEntry {
  return { at, id: `input-${at}`, kind: 'input', text }
}

export function appendTranscriptText(
  entries: readonly NodeTranscriptEntry[],
  kind: 'reasoning' | 'text',
  delta: string,
  at = Date.now()
): NodeTranscriptEntry[] {
  if (!delta) {
    return [...entries]
  }

  const next = [...entries]
  const last = next.at(-1)

  if (last?.kind === kind && 'text' in last) {
    next[next.length - 1] = { ...last, text: `${last.text}${delta}`, at }

    return next
  }

  next.push(textEntry(next, kind, delta, at))

  return next
}

export function setTranscriptFinalText(
  entries: readonly NodeTranscriptEntry[],
  text: string,
  at = Date.now()
): NodeTranscriptEntry[] {
  if (!text) {
    return [...entries]
  }

  const next = [...entries]
  const textIndex = next.findLastIndex(entry => entry.kind === 'text')
  const existing = textIndex >= 0 ? next[textIndex] : undefined

  if (existing?.kind === 'text') {
    if (existing.text === text) {
      return next
    }

    if (text.startsWith(existing.text)) {
      next[textIndex] = { ...existing, at, text }

      return next
    }
  }

  next.push(textEntry(next, 'text', text, at))

  return next
}

export function appendTranscriptStatus(
  entries: readonly NodeTranscriptEntry[],
  text: string,
  status: NodeTranscriptStatus = 'info',
  at = Date.now()
): NodeTranscriptEntry[] {
  if (!text) {
    return [...entries]
  }

  const last = entries.at(-1)

  if (last?.kind === 'status' && last.status === status) {
    return [...entries.slice(0, -1), { ...last, at, text }]
  }

  return [...entries, textEntry(entries, 'status', text, at, status)]
}

function toolId(payload: EventPayload): string {
  return stringValue(payload.tool_id) || stringValue(payload.tool_call_id) || stringValue(payload.id)
}

function toolStatus(payload: EventPayload, phase: 'complete' | 'running'): NodeToolStatus {
  if (phase === 'running') {
    return 'running'
  }

  return payload.error ? 'failed' : 'completed'
}

export function upsertToolTranscript(
  entries: readonly NodeTranscriptEntry[],
  event: GatewayEvent,
  phase: 'complete' | 'running',
  at = Date.now()
): NodeTranscriptEntry[] {
  const payload = payloadRecord(event)
  const name = stringValue(payload.name) || 'tool'
  const stableId = toolId(payload)

  const candidateIndex = stableId
    ? entries.findIndex(entry => entry.kind === 'tool' && entry.id === stableId)
    : [...entries].findLastIndex(entry => entry.kind === 'tool' && entry.name === name && entry.status === 'running')

  const current = candidateIndex >= 0 && entries[candidateIndex]?.kind === 'tool' ? entries[candidateIndex] : undefined
  const id = stableId || current?.id || `tool-${name}-${at}`
  const result = textValue(payload.result_text || payload.result)
  const detail = bounded(stringValue(payload.args_text) || result)

  const nextEntry: NodeTranscriptToolEntry = {
    at: current?.at ?? at,
    context: stringValue(payload.context) || current?.context || stringValue(payload.preview),
    detail: detail || current?.detail || '',
    finishedAt: phase === 'complete' ? at : null,
    id,
    kind: 'tool',
    name,
    status: toolStatus(payload, phase),
    summary: stringValue(payload.summary) || stringValue(payload.message) || current?.summary || ''
  }

  const next = [...entries]

  if (candidateIndex >= 0) {
    next[candidateIndex] = nextEntry
  } else {
    next.push(nextEntry)
  }

  return next
}

function subagentStatus(payload: EventPayload, eventType: string): NodeSubagentStatus {
  const raw = payload.status

  if (raw === 'failed' || raw === 'interrupted' || raw === 'completed' || raw === 'queued' || raw === 'running') {
    return raw
  }

  if (eventType === 'subagent.spawn_requested') {
    return 'queued'
  }

  if (eventType === 'subagent.complete') {
    return payload.error ? 'failed' : 'completed'
  }

  return 'running'
}

function subagentId(payload: EventPayload): string {
  return (
    stringValue(payload.subagent_id) ||
    `${stringValue(payload.parent_id) || 'root'}:${String(payload.task_index ?? 0)}:${stringValue(payload.goal) || 'subagent'}`
  )
}

function appendSubagentStream(
  stream: readonly NodeSubagentStreamEntry[],
  payload: EventPayload,
  eventType: string,
  at: number
): NodeSubagentStreamEntry[] {
  const next = [...stream]
  const tool = stringValue(payload.tool_name)
  const preview = stringValue(payload.tool_preview) || stringValue(payload.text)
  const text = tool ? `${tool}${preview ? `: ${preview}` : ''}` : preview

  const kind: NodeSubagentStreamEntry['kind'] = tool
    ? 'tool'
    : eventType === 'subagent.thinking'
      ? 'thinking'
      : eventType === 'subagent.complete'
        ? 'summary'
        : 'progress'

  if (text) {
    const previous = next.at(-1)

    if (!previous || previous.text !== text || previous.kind !== kind) {
      next.push({ at, isError: Boolean(payload.error), kind, text })
    }
  }

  const summary = stringValue(payload.summary)

  if (eventType === 'subagent.complete' && summary && summary !== next.at(-1)?.text) {
    next.push({ at, isError: Boolean(payload.error), kind: 'summary', text: summary })
  }

  return next.slice(-MAX_SUBAGENT_STREAM)
}

export function upsertSubagentTranscript(
  entries: readonly NodeTranscriptEntry[],
  event: GatewayEvent,
  eventType: string,
  at = Date.now()
): NodeTranscriptEntry[] {
  const payload = payloadRecord(event)
  const id = subagentId(payload)
  const index = entries.findIndex(entry => entry.kind === 'subagent' && entry.id === id)
  const current = index >= 0 && entries[index]?.kind === 'subagent' ? entries[index] : undefined
  const status = subagentStatus(payload, eventType)

  if (current && ['completed', 'failed', 'interrupted'].includes(current.status) && status === 'running') {
    return [...entries]
  }

  const nextEntry: NodeTranscriptSubagentEntry = {
    at: current?.at ?? at,
    currentTool: ['completed', 'failed', 'interrupted'].includes(status)
      ? undefined
      : stringValue(payload.tool_name) || current?.currentTool,
    goal: stringValue(payload.goal) || current?.goal || 'subagent',
    id,
    kind: 'subagent',
    ...(stringValue(payload.model) || current?.model ? { model: stringValue(payload.model) || current?.model } : {}),
    startedAt: current?.startedAt ?? at,
    status,
    stream: appendSubagentStream(current?.stream ?? [], payload, eventType, at),
    ...(stringValue(payload.summary) || current?.summary ? { summary: stringValue(payload.summary) || current?.summary } : {}),
    updatedAt: at
  }

  const next = [...entries]

  if (index >= 0) {
    next[index] = nextEntry
  } else {
    next.push(nextEntry)
  }

  return next
}
