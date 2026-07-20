import { describe, expect, it } from 'vitest'

import { buildWorkflowPrompt } from './prompt'
import type { CouncilWorkflow } from './types'

const graph: CouncilWorkflow = {
  schemaVersion: 1,
  id: 'w1',
  name: 'test',
  nodes: [
    { id: 'a', name: '研究员', role: '寻找事实', model: 'm1', provider: 'p1', position: { x: 0, y: 0 } },
    { id: 'b', name: '评审员', role: '检查事实', model: 'm2', provider: 'p2', position: { x: 300, y: 0 } }
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', createdAt: 1 }],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: 0,
  updatedAt: 0
}

describe('buildWorkflowPrompt', () => {
  it('builds a source prompt without fake upstream data', () => {
    const prompt = buildWorkflowPrompt(graph, graph.nodes[0], '调查这个项目', new Map())

    expect(prompt).toContain('你的角色：寻找事实')
    expect(prompt).toContain('用户原始任务：\n调查这个项目')
    expect(prompt).not.toContain('上游成果')
  })

  it('labels upstream output with a stable node identity', () => {
    const prompt = buildWorkflowPrompt(graph, graph.nodes[1], '调查这个项目', new Map([['a', '事实结果']]))

    expect(prompt).toContain('<上游成果 node_id="a" node_name="研究员">')
    expect(prompt).toContain('事实结果')
    expect(prompt).toContain('角色和用户任务优先')
  })
})
