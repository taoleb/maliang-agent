export interface WorkflowPosition {
  x: number
  y: number
}

export interface WorkflowNode {
  id: string
  name: string
  role: string
  model: string
  provider: string
  position: WorkflowPosition
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  createdAt: number
}

export interface CouncilWorkflow {
  schemaVersion: 1
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  viewport: { x: number; y: number; zoom: number }
  createdAt: number
  updatedAt: number
}

export type NodeRunStatus =
  | 'blocked'
  | 'cancelled'
  | 'completed'
  | 'creating_session'
  | 'failed'
  | 'finishing'
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting_input'

export type WorkflowRunStatus = 'cancelled' | 'completed' | 'failed' | 'interrupted' | 'running' | 'waiting_input'

export type WorkflowPrompt =
  | {
      kind: 'approval'
      allowPermanent: boolean
      command: string
      description: string
      requestId: null
    }
  | {
      kind: 'clarify'
      choices: string[]
      question: string
      requestId: string
    }
  | {
      envVar: string
      kind: 'secret'
      prompt: string
      requestId: string
    }
  | {
      kind: 'sudo'
      requestId: string
    }

export type NodeTranscriptKind = 'input' | 'text' | 'reasoning' | 'status'
export type NodeTranscriptStatus = 'info' | 'success' | 'warning' | 'error'

export interface NodeTranscriptTextEntry {
  at: number
  id: string
  kind: NodeTranscriptKind
  status?: NodeTranscriptStatus
  text: string
}

export type NodeToolStatus = 'completed' | 'failed' | 'running'

export interface NodeTranscriptToolEntry {
  at: number
  context: string
  detail: string
  finishedAt: number | null
  id: string
  kind: 'tool'
  name: string
  status: NodeToolStatus
  summary: string
}

export type NodeSubagentStatus = 'completed' | 'failed' | 'interrupted' | 'queued' | 'running'
export type NodeSubagentStreamKind = 'progress' | 'summary' | 'thinking' | 'tool'

export interface NodeSubagentStreamEntry {
  at: number
  isError?: boolean
  kind: NodeSubagentStreamKind
  text: string
}

export interface NodeTranscriptSubagentEntry {
  at: number
  currentTool?: string
  goal: string
  id: string
  kind: 'subagent'
  model?: string
  startedAt: number
  status: NodeSubagentStatus
  stream: NodeSubagentStreamEntry[]
  summary?: string
  updatedAt: number
}

export type NodeTranscriptEntry = NodeTranscriptTextEntry | NodeTranscriptToolEntry | NodeTranscriptSubagentEntry

export interface NodeRun {
  nodeId: string
  nodeName: string
  model: string
  provider: string
  status: NodeRunStatus
  runtimeSessionId: string | null
  storedSessionId: string | null
  output: string
  promptText: string
  statusText: string
  error: string | null
  prompt: WorkflowPrompt | null
  transcript: NodeTranscriptEntry[]
  lastActivityAt: number | null
  startedAt: number | null
  finishedAt: number | null
}

export interface WorkflowRun {
  id: string
  workflowId: string
  profile: string
  input: string
  status: WorkflowRunStatus
  nodeRuns: Record<string, NodeRun>
  finalNodeId: string | null
  finalOutput: string
  error: string | null
  startedAt: number
  finishedAt: number | null
}
export interface WorkflowValidation {
  errors: string[]
  sinkNodeId: string | null
  topologicalOrder: string[]
}

export interface PersistedWorkflowRun {
  id: string
  workflowId: string
  profile: string
  inputPreview: string
  status: WorkflowRunStatus
  finalNodeId: string | null
  nodeSessions: Array<{
    nodeId: string
    nodeName: string
    model: string
    provider: string
    status: NodeRunStatus
    storedSessionId: string | null
    error: string | null
  }>
  error: string | null
  startedAt: number
  finishedAt: number | null
}
