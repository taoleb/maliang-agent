import { describe, expect, it } from 'vitest'

import { readyNodeIds, topologicalOrder, validateWorkflow } from './graph'
import type { CouncilWorkflow } from './types'

const workflow = (edges: CouncilWorkflow['edges'] = []): CouncilWorkflow => ({
  schemaVersion: 1,
  id: 'w1',
  name: 'test',
  nodes: [
    { id: 'a', name: 'A', role: 'research', model: 'm1', provider: 'p1', position: { x: 0, y: 0 } },
    { id: 'b', name: 'B', role: 'review', model: 'm2', provider: 'p2', position: { x: 300, y: 0 } },
    { id: 'c', name: 'C', role: 'write', model: 'm3', provider: 'p3', position: { x: 600, y: 0 } }
  ],
  edges,
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: 0,
  updatedAt: 0
})

const edge = (id: string, source: string, target: string, createdAt = 0) => ({ id, source, target, createdAt })

describe('workflow graph', () => {
  it('validates a linear workflow and finds its sink', () => {
    const result = validateWorkflow(workflow([edge('ab', 'a', 'b'), edge('bc', 'b', 'c')]))

    expect(result.errors).toEqual([])
    expect(result.sinkNodeId).toBe('c')
    expect(result.topologicalOrder).toEqual(['a', 'b', 'c'])
  })

  it('rejects cycles', () => {
    const cycle = validateWorkflow(workflow([edge('ab', 'a', 'b'), edge('ba', 'b', 'a'), edge('ac', 'a', 'c')]))

    expect(cycle.errors).toContain('编排存在循环，必须调整为有向无环图')
  })

  it('rejects multiple sinks', () => {
    const multipleSinks = validateWorkflow(workflow([edge('ab', 'a', 'b')]))

    expect(multipleSinks.errors).toContain('编排只能有一个最终节点')
  })

  it('waits for every incoming node before a fan-in node becomes ready', () => {
    const graph = workflow([edge('ac', 'a', 'c'), edge('bc', 'b', 'c')])

    expect(readyNodeIds(graph, { a: { status: 'completed' }, b: { status: 'running' }, c: { status: 'ready' } })).toEqual([])
    expect(readyNodeIds(graph, { a: { status: 'completed' }, b: { status: 'completed' }, c: { status: 'ready' } })).toEqual(['c'])
  })

  it('keeps disconnected nodes invalid through the unique-sink rule', () => {
    const graph = workflow([edge('ab', 'a', 'b')])

    expect(validateWorkflow(graph).errors).toContain('编排只能有一个最终节点')
    expect(topologicalOrder(graph)).toEqual(['a', 'c', 'b'])
  })
})
