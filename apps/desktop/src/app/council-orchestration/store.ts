import { atom, computed } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'

import type { CouncilWorkflow, NodeRun, PersistedWorkflowRun, WorkflowEdge, WorkflowNode, WorkflowRun } from './types'

const WORKFLOWS_KEY = 'maliang.desktop.council-orchestration.workflows.v1'
const RUNS_KEY = 'maliang.desktop.council-orchestration.runs.v1'
const MAX_HISTORY = 20

const now = () => Date.now()

function id(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function sanitizeNode(value: unknown, index: number): WorkflowNode | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<WorkflowNode>
  const idValue = text(row.id).trim()

  if (!idValue) {
    return null
  }

  return {
    id: idValue,
    name: text(row.name, `智囊 ${index + 1}`).slice(0, 80),
    role: text(row.role).slice(0, 4_000),
    model: text(row.model),
    provider: text(row.provider),
    position: {
      x: finite(row.position?.x, 80 + index * 280),
      y: finite(row.position?.y, 100)
    }
  }
}

function sanitizeEdge(value: unknown): WorkflowEdge | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<WorkflowEdge>
  const edgeId = text(row.id).trim()
  const source = text(row.source).trim()
  const target = text(row.target).trim()

  if (!edgeId || !source || !target) {
    return null
  }

  return { id: edgeId, source, target, createdAt: finite(row.createdAt, now()) }
}

function sanitizeWorkflow(value: unknown): CouncilWorkflow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<CouncilWorkflow>
  const workflowId = text(row.id).trim()

  if (!workflowId) {
    return null
  }

  const rawNodes = Array.isArray(row.nodes) ? row.nodes : []
  const nodes = rawNodes.map(sanitizeNode).filter((node): node is WorkflowNode => Boolean(node))
  const nodeIds = new Set(nodes.map(node => node.id))

  const edges = (Array.isArray(row.edges) ? row.edges : [])
    .map(sanitizeEdge)
    .filter((edge): edge is WorkflowEdge => Boolean(edge))
    .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))

  return {
    schemaVersion: 1,
    id: workflowId,
    name: text(row.name, '未命名编排').trim().slice(0, 80) || '未命名编排',
    nodes,
    edges,
    viewport: {
      x: finite(row.viewport?.x, 0),
      y: finite(row.viewport?.y, 0),
      zoom: Math.min(2, Math.max(0.25, finite(row.viewport?.zoom, 1)))
    },
    createdAt: finite(row.createdAt, now()),
    updatedAt: finite(row.updatedAt, now())
  }
}

function sanitizeWorkflows(value: unknown): CouncilWorkflow[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()

  return value
    .map(sanitizeWorkflow)
    .filter((workflow): workflow is CouncilWorkflow => {
      if (!workflow || seen.has(workflow.id)) {
        return false
      }

      seen.add(workflow.id)

      return true
    })
}

function sanitizeRun(value: unknown): PersistedWorkflowRun | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<PersistedWorkflowRun>
  const runId = text(row.id).trim()
  const workflowId = text(row.workflowId).trim()

  if (!runId || !workflowId) {
    return null
  }

  const nodeSessions = Array.isArray(row.nodeSessions)
    ? row.nodeSessions
        .filter(item => item && typeof item === 'object')
        .map(item => {
          const node = item as Partial<PersistedWorkflowRun['nodeSessions'][number]>

          return {
            nodeId: text(node.nodeId),
            nodeName: text(node.nodeName),
            model: text(node.model),
            provider: text(node.provider),
            status: node.status ?? 'failed',
            storedSessionId: text(node.storedSessionId) || null,
            error: text(node.error) || null
          }
        })
        .filter(node => node.nodeId)
    : []

  return {
    id: runId,
    workflowId,
    profile: text(row.profile, 'default'),
    inputPreview: text(row.inputPreview).slice(0, 240),
    status: row.status ?? 'interrupted',
    finalNodeId: text(row.finalNodeId) || null,
    nodeSessions,
    error: text(row.error) || null,
    startedAt: finite(row.startedAt, now()),
    finishedAt: typeof row.finishedAt === 'number' ? row.finishedAt : null
  }
}

function sanitizeRunHistory(value: unknown): Record<string, PersistedWorkflowRun[]> {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const out: Record<string, PersistedWorkflowRun[]> = {}

  for (const [workflowId, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) {
      continue
    }

    out[workflowId] = rows
      .map(sanitizeRun)
      .filter((run): run is PersistedWorkflowRun => Boolean(run))
      .slice(0, MAX_HISTORY)
  }

  return out
}

export const $workflows = persistentAtom<CouncilWorkflow[]>(WORKFLOWS_KEY, [], Codecs.json(sanitizeWorkflows))
export const $workflowRunHistory = persistentAtom<Record<string, PersistedWorkflowRun[]>>(
  RUNS_KEY,
  {},
  Codecs.json(sanitizeRunHistory)
)
export const $activeWorkflowId = atom<string | null>(null)
export const $workflowRuns = atom<Record<string, WorkflowRun>>({})
export const $activeWorkflowRun = computed([$workflowRuns, $activeWorkflowId], (runs, workflowId) =>
  workflowId ? runs[workflowId] ?? null : null
)

export function createWorkflow(): CouncilWorkflow {
  const timestamp = now()

  const workflow: CouncilWorkflow = {
    schemaVersion: 1,
    id: id('workflow'),
    name: '未命名编排',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: timestamp,
    updatedAt: timestamp
  }

  $workflows.set([...$workflows.get(), workflow])
  $activeWorkflowId.set(workflow.id)

  return workflow
}

export function updateWorkflow(workflowId: string, update: (workflow: CouncilWorkflow) => CouncilWorkflow): void {
  $workflows.set(
    $workflows.get().map(workflow =>
      workflow.id === workflowId ? { ...update(workflow), updatedAt: now(), schemaVersion: 1 } : workflow
    )
  )
}

export function replaceWorkflow(workflow: CouncilWorkflow): void {
  updateWorkflow(workflow.id, () => workflow)
}

export function duplicateWorkflow(workflowId: string): CouncilWorkflow | null {
  const source = $workflows.get().find(workflow => workflow.id === workflowId)

  if (!source) {
    return null
  }

  const timestamp = now()

  const copy: CouncilWorkflow = {
    ...source,
    id: id('workflow'),
    name: `${source.name} 副本`,
    nodes: source.nodes.map(node => ({ ...node })),
    edges: source.edges.map(edge => ({ ...edge })),
    createdAt: timestamp,
    updatedAt: timestamp
  }

  $workflows.set([...$workflows.get(), copy])
  $activeWorkflowId.set(copy.id)

  return copy
}

export function deleteWorkflow(workflowId: string): void {
  $workflows.set($workflows.get().filter(workflow => workflow.id !== workflowId))

  const history = { ...$workflowRunHistory.get() }
  delete history[workflowId]
  $workflowRunHistory.set(history)

  if ($activeWorkflowId.get() === workflowId) {
    $activeWorkflowId.set($workflows.get()[0]?.id ?? null)
  }
}

export function makeNodeRun(node: WorkflowNode, status: NodeRun['status'] = 'pending'): NodeRun {
  return {
    nodeId: node.id,
    nodeName: node.name,
    model: node.model,
    provider: node.provider,
    status,
    runtimeSessionId: null,
    storedSessionId: null,
    output: '',
    statusText: '',
    error: null,
    prompt: null,
    startedAt: null,
    finishedAt: null
  }
}

export function setWorkflowRun(run: WorkflowRun): void {
  $workflowRuns.set({ ...$workflowRuns.get(), [run.workflowId]: run })
}

export function clearWorkflowRun(workflowId: string): void {
  const runs = { ...$workflowRuns.get() }
  delete runs[workflowId]
  $workflowRuns.set(runs)
}

export function saveWorkflowRunRecord(run: WorkflowRun): void {
  const record: PersistedWorkflowRun = {
    id: run.id,
    workflowId: run.workflowId,
    profile: run.profile,
    inputPreview: run.input.slice(0, 240),
    status: run.status,
    finalNodeId: run.finalNodeId,
    nodeSessions: Object.values(run.nodeRuns).map(node => ({
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      model: node.model,
      provider: node.provider,
      status: node.status,
      storedSessionId: node.storedSessionId,
      error: node.error
    })),
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt
  }

  const history = { ...$workflowRunHistory.get() }
  history[run.workflowId] = [record, ...(history[run.workflowId] ?? [])].slice(0, MAX_HISTORY)
  $workflowRunHistory.set(history)
}

export function workflowHistory(workflowId: string): PersistedWorkflowRun[] {
  return $workflowRunHistory.get()[workflowId] ?? []
}

export function createWorkflowId(): string {
  return id('run')
}
