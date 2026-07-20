import type { CouncilWorkflow, WorkflowEdge, WorkflowNode, WorkflowValidation } from './types'

export function incomingEdges(workflow: Pick<CouncilWorkflow, 'edges'>, nodeId: string): WorkflowEdge[] {
  return workflow.edges
    .filter(edge => edge.target === nodeId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}
export function outgoingEdges(workflow: Pick<CouncilWorkflow, 'edges'>, nodeId: string): WorkflowEdge[] {
  return workflow.edges
    .filter(edge => edge.source === nodeId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function topologicalOrder(workflow: Pick<CouncilWorkflow, 'nodes' | 'edges'>): string[] {
  const nodeIds = new Set(workflow.nodes.map(node => node.id))
  const indegree = new Map(workflow.nodes.map(node => [node.id, 0]))
  const outgoing = new Map<string, string[]>()

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue
    }

    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  const queue = workflow.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id)
  const order: string[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    order.push(current)

    for (const target of outgoing.get(current) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)

      if (next === 0) {
        queue.push(target)
      }
    }
  }

  return order
}

export function validateWorkflow(workflow: CouncilWorkflow): WorkflowValidation {
  const errors: string[] = []
  const ids = new Set<string>()
  const nodesById = new Map<string, WorkflowNode>()

  if (workflow.nodes.length < 2) {
    errors.push('至少添加两个智能体')
  }

  for (const node of workflow.nodes) {
    if (ids.has(node.id)) {
      errors.push(`节点 ID 重复：${node.id}`)
    }

    ids.add(node.id)
    nodesById.set(node.id, node)

    if (!node.name.trim()) {
      errors.push(`节点 ${node.id} 缺少名称`)
    }

    if (!node.role.trim()) {
      errors.push(`节点 ${node.name || node.id} 尚未配置角色`)
    }

    if (!node.model.trim() || !node.provider.trim()) {
      errors.push(`节点 ${node.name || node.id} 尚未配置模型`)
    }
  }

  const edgeIds = new Set<string>()
  const pairs = new Set<string>()

  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(`连线 ID 重复：${edge.id}`)
    }

    edgeIds.add(edge.id)

    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      errors.push(`连线 ${edge.id} 指向不存在的节点`)
    }

    if (edge.source === edge.target) {
      errors.push(`节点 ${nodesById.get(edge.source)?.name || edge.source} 不能连接自己`)
    }

    const pair = `${edge.source}->${edge.target}`

    if (pairs.has(pair)) {
      errors.push(`节点之间存在重复连线：${pair}`)
    }

    pairs.add(pair)
  }

  const order = topologicalOrder(workflow)
  const sinkNodes = workflow.nodes.filter(node => outgoingEdges(workflow, node.id).length === 0)
  const sinkNodeId = sinkNodes.length === 1 ? sinkNodes[0].id : null

  if (order.length !== workflow.nodes.length) {
    errors.push('编排存在循环，必须调整为有向无环图')
  }

  if (sinkNodes.length === 0) {
    errors.push('编排没有最终节点')
  } else if (sinkNodes.length > 1) {
    errors.push('编排只能有一个最终节点')
  }

  return { errors: [...new Set(errors)], sinkNodeId, topologicalOrder: order }
}

export function readyNodeIds(
  workflow: CouncilWorkflow,
  nodeRuns: Readonly<Record<string, { status: string; output?: string }>>
): string[] {
  return workflow.nodes
    .filter(node => nodeRuns[node.id]?.status === 'ready')
    .filter(node => incomingEdges(workflow, node.id).every(edge => nodeRuns[edge.source]?.status === 'completed'))
    .map(node => node.id)
}
