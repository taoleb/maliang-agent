import type { GatewayEvent } from '@maliang/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MaliangGateway } from '@/maliang'

import {
  activeWorkflowRun,
  cancelWorkflowRun,
  consumeWorkflowGatewayEvent,
  respondToWorkflowPrompt,
  startWorkflowRun
} from './runtime'
import { $activeWorkflowId, $workflowRunHistory, $workflowRuns } from './store'
import type { CouncilWorkflow, WorkflowEdge } from './types'

interface GatewayCall {
  method: string
  params: Record<string, unknown> | undefined
}

type FakeGateway = Pick<MaliangGateway, 'request'>

function node(id: string, name = id) {
  return {
    id,
    name,
    role: `${name} role`,
    model: `${name}-model`,
    provider: `${name}-provider`,
    position: { x: 0, y: 0 }
  }
}

function workflow(id: string, nodes: string[], edges: WorkflowEdge[]): CouncilWorkflow {
  return {
    schemaVersion: 1,
    id,
    name: id,
    nodes: nodes.map(item => node(item, item.toUpperCase())),
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 0,
    updatedAt: 0
  }
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target, createdAt: Number(id.replace(/\D/g, '') || 0) }
}

function event(sessionId: string, type: string, payload: Record<string, unknown> = {}): GatewayEvent {
  return { payload, session_id: sessionId, type }
}

function completeNode(sessionId: string, text: string): void {
  consumeWorkflowGatewayEvent(event(sessionId, 'message.complete', { status: 'complete', text }))
  consumeWorkflowGatewayEvent(event(sessionId, 'session.info', { running: false }))
}

function gatewayFixture() {
  let sessionNumber = 0
  const calls: GatewayCall[] = []

  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params })

    if (method === 'session.create') {
      sessionNumber += 1

      return { session_id: `runtime-${sessionNumber}`, stored_session_id: `stored-${sessionNumber}` }
    }

    return {}
  })

  return { calls, gateway: { request } as FakeGateway }
}

beforeEach(() => {
  window.localStorage.clear()
  $activeWorkflowId.set(null)
  $workflowRunHistory.set({})
  $workflowRuns.set({})
})

describe('workflow runtime', () => {
  it('does not start a downstream node until its upstream completes', async () => {
    const { calls, gateway } = gatewayFixture()
    const graph = workflow('linear', ['a', 'b', 'c'], [edge('1', 'a', 'b'), edge('2', 'b', 'c')])

    expect(startWorkflowRun(graph, 'task', 'default', gateway as MaliangGateway).ok).toBe(true)
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(1))
    expect(activeWorkflowRun('linear')?.nodeRuns.b.status).toBe('pending')

    expect(consumeWorkflowGatewayEvent(event('runtime-1', 'message.complete', { status: 'complete', text: 'A output' }))).toBe(true)
    expect(activeWorkflowRun('linear')?.nodeRuns.a.status).toBe('finishing')
    consumeWorkflowGatewayEvent(event('runtime-1', 'message.delta', { text: 'late delta' }))
    expect(activeWorkflowRun('linear')?.nodeRuns.a.output).toBe('A output')
    consumeWorkflowGatewayEvent(event('runtime-1', 'session.info', { running: false }))
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(2))

    const prompts = calls.filter(call => call.method === 'prompt.submit')
    expect(prompts[1]?.params?.text).toContain('A output')
    expect(activeWorkflowRun('linear')?.nodeRuns.c.status).toBe('pending')

    completeNode('runtime-2', 'B output')
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(3))
    completeNode('runtime-3', 'C output')

    await vi.waitFor(() => expect(activeWorkflowRun('linear')?.status).toBe('completed'))
    expect(activeWorkflowRun('linear')?.finalOutput).toBe('C output')
    expect(calls.filter(call => call.method === 'session.close')).toHaveLength(3)
    expect($workflowRunHistory.get().linear).toHaveLength(1)
  })

  it('waits for every upstream node before a fan-in node starts', async () => {
    const { calls, gateway } = gatewayFixture()
    const graph = workflow('fan-in', ['a', 'b', 'c'], [edge('1', 'a', 'c'), edge('2', 'b', 'c')])

    startWorkflowRun(graph, 'task', 'default', gateway as MaliangGateway)
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(2))

    completeNode('runtime-1', 'A output')
    await vi.waitFor(() => expect(activeWorkflowRun('fan-in')?.nodeRuns.a.status).toBe('completed'))
    expect(calls.filter(call => call.method === 'session.create')).toHaveLength(2)
    expect(activeWorkflowRun('fan-in')?.nodeRuns.c.status).toBe('pending')

    completeNode('runtime-2', 'B output')
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(3))

    const finalPrompt = calls.filter(call => call.method === 'prompt.submit')[2]?.params?.text
    expect(finalPrompt).toContain('A output')
    expect(finalPrompt).toContain('B output')
    completeNode('runtime-3', 'C output')
    await vi.waitFor(() => expect(activeWorkflowRun('fan-in')?.status).toBe('completed'))
  })

  it('fails fast and closes active sessions when one node fails', async () => {
    const { calls, gateway } = gatewayFixture()
    const graph = workflow('failure', ['a', 'b', 'c'], [edge('1', 'a', 'c'), edge('2', 'b', 'c')])

    startWorkflowRun(graph, 'task', 'default', gateway as MaliangGateway)
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(2))

    consumeWorkflowGatewayEvent(event('runtime-1', 'error', { message: 'upstream failed' }))
    await vi.waitFor(() => expect(activeWorkflowRun('failure')?.status).toBe('failed'))

    const run = activeWorkflowRun('failure')
    expect(run?.nodeRuns.a.status).toBe('failed')
    expect(run?.nodeRuns.b.status).toBe('cancelled')
    expect(run?.nodeRuns.c.status).toBe('blocked')
    expect(calls.filter(call => call.method === 'session.close')).toHaveLength(2)
  })

  it('sends approval choices to the node session', async () => {
    const { calls, gateway } = gatewayFixture()
    const graph = workflow('approval', ['a', 'b'], [edge('1', 'a', 'b')])

    startWorkflowRun(graph, 'task', 'default', gateway as MaliangGateway)
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(1))
    consumeWorkflowGatewayEvent(event('runtime-1', 'approval.request', { description: 'Allow command', allow_permanent: true }))
    await vi.waitFor(() => expect(activeWorkflowRun('approval')?.nodeRuns.a.prompt?.kind).toBe('approval'))

    await respondToWorkflowPrompt('approval', 'a', 'once', 'once')
    expect(calls.at(-1)).toEqual({ method: 'approval.respond', params: { choice: 'once', session_id: 'runtime-1' } })
    expect(activeWorkflowRun('approval')?.nodeRuns.a.status).toBe('running')
    await cancelWorkflowRun('approval')
  })

  it('closes a session created after cancellation instead of submitting work', async () => {
    let resolveCreate: ((value: { session_id: string; stored_session_id: string }) => void) | undefined
    const calls: GatewayCall[] = []

    const request = vi.fn((method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })

      if (method === 'session.create') {
        return new Promise(resolve => {
          resolveCreate = resolve
        })
      }

      return Promise.resolve({})
    })

    const graph = workflow('cancel', ['a', 'b'], [edge('1', 'a', 'b')])

    startWorkflowRun(graph, 'task', 'default', { request } as FakeGateway as MaliangGateway)
    await vi.waitFor(() => expect(calls[0]?.method).toBe('session.create'))
    await cancelWorkflowRun('cancel')
    resolveCreate?.({ session_id: 'runtime-late', stored_session_id: 'stored-late' })

    await vi.waitFor(() => expect(calls.some(call => call.method === 'session.close' && call.params?.session_id === 'runtime-late')).toBe(true))
    expect(calls.some(call => call.method === 'prompt.submit')).toBe(false)
    expect(activeWorkflowRun('cancel')?.status).toBe('cancelled')
  })

  it('leaves unrelated gateway events for the normal chat handler', () => {
    expect(consumeWorkflowGatewayEvent(event('unknown-session', 'message.delta', { text: 'chat' }))).toBe(false)
  })

  it('runs the same workflow twice without stale session routing', async () => {
    const { calls, gateway } = gatewayFixture()
    const graph = workflow('repeat', ['a', 'b'], [edge('1', 'a', 'b')])

    startWorkflowRun(graph, 'first task', 'default', gateway as MaliangGateway)
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(1))
    completeNode('runtime-1', 'first A')
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(2))
    completeNode('runtime-2', 'first B')
    await vi.waitFor(() => expect(activeWorkflowRun('repeat')?.status).toBe('completed'))

    const firstRunId = activeWorkflowRun('repeat')?.id
    expect(consumeWorkflowGatewayEvent(event('runtime-2', 'message.delta', { text: 'late event' }))).toBe(false)

    startWorkflowRun(graph, 'second task', 'default', gateway as MaliangGateway)
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(3))
    expect(activeWorkflowRun('repeat')?.id).not.toBe(firstRunId)
    completeNode('runtime-3', 'second A')
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'session.create')).toHaveLength(4))
    completeNode('runtime-4', 'second B')
    await vi.waitFor(() => expect(activeWorkflowRun('repeat')?.status).toBe('completed'))

    expect(activeWorkflowRun('repeat')?.finalOutput).toBe('second B')
    expect($workflowRunHistory.get().repeat).toHaveLength(2)
    expect(calls.filter(call => call.method === 'session.close')).toHaveLength(4)
  })
})
