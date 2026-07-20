import '@xyflow/react/dist/style.css'

import { useStore } from '@nanostores/react'
import {
  Background,
  type Connection,
  Controls,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  MarkerType,
  MiniMap,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ModelPickerDialog } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Brain, Copy, GitBranch, Play, Plus, RefreshCw, Trash2, X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { MaliangGateway } from '@/maliang'
import { activeGateway } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'

import { validateWorkflow } from './graph'
import type { activeWorkflowRun } from './runtime'
import {
  cancelWorkflowRun,
  deleteHistoricalRun,
  loadHistoricalNodeOutput,
  respondToWorkflowPrompt,
  startWorkflowRun
} from './runtime'
import {
  $activeWorkflowId,
  $activeWorkflowRun,
  $workflowRunHistory,
  $workflowRuns,
  $workflows,
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  updateWorkflow
} from './store'
import type { CouncilWorkflow, NodeRun, PersistedWorkflowRun, WorkflowNode } from './types'

export interface CouncilOrchestrationViewProps {
  gateway: MaliangGateway | null
}

interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode
  run?: NodeRun
}

type CanvasNode = FlowNode<WorkflowNodeData, 'workflow'>

const nodeTypes = { workflow: WorkflowCanvasNode }

const statusLabel: Record<NodeRun['status'], string> = {
  blocked: '已跳过',
  cancelled: '已取消',
  completed: '已完成',
  creating_session: '创建会话',
  failed: '失败',
  pending: '等待上游',
  ready: '待运行',
  running: '运行中',
  waiting_input: '等待输入'
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function WorkflowCanvasNode({ data, selected }: NodeProps<CanvasNode>) {
  const run = data.run
  const configured = Boolean(data.node.role.trim() && data.node.model.trim())

  return (
    <div
      aria-label={`${data.node.name}，${configured ? '已配置' : '未配置'}`}
      className={cn(
        'min-w-52 rounded-lg border bg-(--ui-editor-surface-background) text-foreground shadow-sm transition-colors',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-(--ui-stroke-secondary)',
        run?.status === 'failed' && 'border-destructive/70',
        run?.status === 'completed' && 'border-emerald-500/60'
      )}
      role="group"
    >
      <Handle className="!size-3 !border-2 !border-background !bg-primary" position={Position.Left} type="target" />
      <div className="flex items-center gap-2 border-b border-(--ui-stroke-tertiary) px-3 py-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-(--ui-control-active-background) text-xs">
          <GitBranch className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{data.node.name}</span>
        {run && <span className="text-[0.64rem] text-(--ui-text-tertiary)">{statusLabel[run.status]}</span>}
      </div>
      <div className="space-y-1 px-3 py-2 text-[0.68rem]">
        <p className="truncate text-(--ui-text-secondary)" title={data.node.role || '尚未配置角色'}>
          {data.node.role || '尚未配置角色'}
        </p>
        <p className="flex items-center gap-1 truncate font-mono text-(--ui-text-tertiary)">
          <Brain className="size-3 shrink-0" />
          {data.node.model || '尚未选择模型'}
        </p>
      </div>
      <Handle className="!size-3 !border-2 !border-background !bg-primary" position={Position.Right} type="source" />
    </div>
  )
}

function flowNodes(workflow: CouncilWorkflow, run: ReturnType<typeof activeWorkflowRun>): CanvasNode[] {
  return workflow.nodes.map(node => ({
    id: node.id,
    type: 'workflow',
    position: node.position,
    data: { node, run: run?.nodeRuns[node.id] }
  }))
}

function flowEdges(workflow: CouncilWorkflow, run: ReturnType<typeof activeWorkflowRun>): FlowEdge[] {
  return workflow.edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: Boolean(run && (run.nodeRuns[edge.source]?.status === 'running' || run.nodeRuns[edge.target]?.status === 'running')),
    style: { stroke: 'var(--ui-text-tertiary)', strokeWidth: 1.5 }
  }))
}

function currentNodeRun(run: ReturnType<typeof activeWorkflowRun>, nodeId: string | null): NodeRun | null {
  return nodeId && run ? run.nodeRuns[nodeId] ?? null : null
}

function isWorkflowBusy(run: ReturnType<typeof activeWorkflowRun>): boolean {
  return run?.status === 'running' || run?.status === 'waiting_input'
}

export function CouncilOrchestrationView({ gateway }: CouncilOrchestrationViewProps) {
  const workflows = useStore($workflows)
  const activeWorkflowId = useStore($activeWorkflowId)
  const activeRun = useStore($activeWorkflowRun)
  const workflowRuns = useStore($workflowRuns)
  const runHistory = useStore($workflowRunHistory)
  const gatewayState = useStore($gatewayState)
  const activeProfile = useStore($activeGatewayProfile)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [modelPickerNodeId, setModelPickerNodeId] = useState<string | null>(null)
  const [taskInput, setTaskInput] = useState('')
  const [promptAnswer, setPromptAnswer] = useState('')
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [historyOutput, setHistoryOutput] = useState('')
  const [panelTab, setPanelTab] = useState<'node' | 'run'>('run')

  const workflow = workflows.find(item => item.id === activeWorkflowId) ?? workflows[0] ?? null
  const anyWorkflowBusy = Object.values(workflowRuns).some(isWorkflowBusy)
  const currentWorkflowBusy = isWorkflowBusy(activeRun)
  const validation = useMemo(() => (workflow ? validateWorkflow(workflow) : null), [workflow])
  const selectedNode = workflow?.nodes.find(node => node.id === selectedNodeId) ?? null
  const selectedRunNode = currentNodeRun(activeRun, selectedNodeId)
  const promptedRunNode = Object.values(activeRun?.nodeRuns ?? {}).find(item => item.prompt) ?? null
  const promptNode = selectedRunNode?.prompt ? selectedRunNode : promptedRunNode
  const historicalRows = useMemo(() => (workflow ? runHistory[workflow.id] ?? [] : []), [runHistory, workflow])

  useEffect(() => {
    if (!workflow && workflows.length === 0) {
      createWorkflow()
    }
  }, [workflow, workflows.length])

  useEffect(() => {
    if (selectedNodeId && !workflow?.nodes.some(node => node.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }, [selectedNodeId, workflow])

  useEffect(() => {
    if (!selectedHistoryId) {
      setHistoryOutput('')

      return
    }

    const record = historicalRows.find(row => row.id === selectedHistoryId)
    const sinkId = record?.finalNodeId

    if (!record || !sinkId) {
      setHistoryOutput('')

      return
    }

    let cancelled = false
    void loadHistoricalNodeOutput(record, sinkId)
      .then(output => {
        if (!cancelled) {
          setHistoryOutput(output)
        }
      })
      .catch(error => {
        if (!cancelled) {
          setHistoryOutput(error instanceof Error ? error.message : String(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [historicalRows, selectedHistoryId])

  const updateNode = useCallback(
    (nodeId: string, update: (node: WorkflowNode) => WorkflowNode) => {
      if (!workflow || anyWorkflowBusy) {
        return
      }

      updateWorkflow(workflow.id, current => ({
        ...current,
        nodes: current.nodes.map(node => (node.id === nodeId ? update(node) : node))
      }))
    },
    [anyWorkflowBusy, workflow]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!workflow || anyWorkflowBusy || !connection.source || !connection.target) {
        return
      }

      const next = {
        ...workflow,
        edges: [
          ...workflow.edges,
          { id: makeId('edge'), source: connection.source, target: connection.target, createdAt: Date.now() }
        ]
      }

      const result = validateWorkflow(next)

      if (result.errors.some(error => error.includes('循环') || error.includes('重复连线') || error.includes('自己'))) {
        return
      }

      updateWorkflow(workflow.id, current => ({ ...current, edges: next.edges }))
    },
    [anyWorkflowBusy, workflow]
  )

  const onNodeDragStop = useCallback(
    (_event: unknown, node: CanvasNode) => {
      updateNode(node.id, current => ({ ...current, position: { x: node.position.x, y: node.position.y } }))
    },
    [updateNode]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      if (!workflow || anyWorkflowBusy) {
        return
      }

      const positions = new Map<string, { x: number; y: number }>()

      for (const change of changes) {
        if ('id' in change && change.type === 'position' && change.position) {
          positions.set(change.id, change.position)
        }
      }

      if (positions.size === 0) {
        return
      }

      updateWorkflow(workflow.id, current => ({
        ...current,
        nodes: current.nodes.map(node => {
          const position = positions.get(node.id)

          return position ? { ...node, position } : node
        })
      }))
    },
    [anyWorkflowBusy, workflow]
  )

  const removeSelectedNode = useCallback(() => {
    if (!workflow || !selectedNodeId || anyWorkflowBusy) {
      return
    }

    const node = workflow.nodes.find(item => item.id === selectedNodeId)

    if (!node || !window.confirm(`确定删除“${node.name}”及其连线吗？`)) {
      return
    }

    updateWorkflow(workflow.id, current => ({
      ...current,
      nodes: current.nodes.filter(item => item.id !== selectedNodeId),
      edges: current.edges.filter(edge => edge.source !== selectedNodeId && edge.target !== selectedNodeId)
    }))
    setSelectedNodeId(null)
  }, [anyWorkflowBusy, selectedNodeId, workflow])

  const addNode = useCallback(() => {
    if (!workflow || anyWorkflowBusy) {
      return
    }

    const nodeNumber = workflow.nodes.length + 1

    const node: WorkflowNode = {
      id: makeId('node'),
      name: `智囊 ${nodeNumber}`,
      role: '',
      model: '',
      provider: '',
      position: { x: 80 + (nodeNumber - 1) * 280, y: 120 }
    }

    updateWorkflow(workflow.id, current => ({ ...current, nodes: [...current.nodes, node] }))
    setSelectedNodeId(node.id)
  }, [anyWorkflowBusy, workflow])

  const run = useCallback(() => {
    if (!workflow || !taskInput.trim() || gatewayState !== 'open') {
      return
    }

    const selectedGateway = gateway ?? activeGateway()

    if (!selectedGateway) {
      window.alert('马良 gateway 尚未连接')

      return
    }

    const result = startWorkflowRun(workflow, taskInput.trim(), activeProfile, selectedGateway)

    if (result.ok) {
      setSelectedHistoryId(null)

      return
    }

    window.alert(result.errors.join('\n'))
  }, [activeProfile, gateway, gatewayState, taskInput, workflow])

  const addUpstream = useCallback(
    (source: string, checked: boolean) => {
      if (!workflow || !selectedNode || anyWorkflowBusy || source === selectedNode.id) {
        return
      }

      const exists = workflow.edges.some(edge => edge.source === source && edge.target === selectedNode.id)

      const edges = checked
        ? exists
          ? workflow.edges
          : [...workflow.edges, { id: makeId('edge'), source, target: selectedNode.id, createdAt: Date.now() }]
        : workflow.edges.filter(edge => !(edge.source === source && edge.target === selectedNode.id))

      const next = { ...workflow, edges }

      if (checked && validateWorkflow(next).errors.some(error => error.includes('循环'))) {
        return
      }

      updateWorkflow(workflow.id, current => ({ ...current, edges }))
    },
    [anyWorkflowBusy, selectedNode, workflow]
  )

  const selectedModel = modelPickerNodeId ? workflow?.nodes.find(node => node.id === modelPickerNodeId) : null

  if (!workflow) {
    return <div className="grid h-full place-items-center text-sm text-(--ui-text-tertiary)">正在准备编排画布…</div>
  }

  const currentNodes = flowNodes(workflow, activeRun)
  const currentEdges = flowEdges(workflow, activeRun)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background) pt-(--titlebar-height)">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-(--ui-stroke-secondary) px-3">
        <GitBranch className="size-4 text-(--ui-text-secondary)" />
        <Input
          aria-label="编排名称"
          className="h-7 w-48 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none focus-visible:border-primary"
          disabled={anyWorkflowBusy}
          onChange={event => updateWorkflow(workflow.id, current => ({ ...current, name: event.target.value.slice(0, 80) }))}
          value={workflow.name}
        />
        <span className="text-[0.68rem] text-(--ui-text-tertiary)">{workflow.nodes.length} 个节点</span>
        <div className="ml-auto flex items-center gap-1">
          <Button aria-label="添加智能体" disabled={anyWorkflowBusy} onClick={addNode} size="sm" variant="outline">
            <Plus className="size-3.5" />
            添加智能体
          </Button>
          {currentWorkflowBusy ? (
            <Button aria-label="取消当前运行" onClick={() => void cancelWorkflowRun(workflow.id)} size="sm" variant="destructive">
              <X className="size-3.5" />
              取消运行
            </Button>
          ) : (
            <Button aria-label="开始运行" disabled={anyWorkflowBusy || !taskInput.trim() || gatewayState !== 'open'} onClick={run} size="sm">
              <Play className="size-3.5" />
              运行
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_20rem]">
        <aside className="min-h-0 overflow-y-auto border-r border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) p-2">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">我的编排</span>
            <Button aria-label="新建编排" disabled={anyWorkflowBusy} onClick={() => createWorkflow()} size="icon-xs" variant="ghost">
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="space-y-1">
            {workflows.map(item => (
              <button
                className={cn(
                  'flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-(--ui-control-hover-background)',
                  item.id === workflow.id && 'bg-(--ui-control-active-background) text-foreground'
                )}
                key={item.id}
                onClick={() => $activeWorkflowId.set(item.id)}
                type="button"
              >
                <GitBranch className="size-3.5 shrink-0 text-(--ui-text-tertiary)" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-(--ui-stroke-tertiary) pt-3">
            <div className="grid grid-cols-2 gap-1">
              <Button aria-label="复制当前编排" disabled={anyWorkflowBusy} onClick={() => duplicateWorkflow(workflow.id)} size="xs" variant="ghost">
                <Copy className="size-3" />
                复制
              </Button>
              <Button
                aria-label="删除当前编排"
                disabled={anyWorkflowBusy || workflows.length <= 1}
                onClick={() => {
                  if (window.confirm(`确定删除“${workflow.name}”吗？`)) {
                    void Promise.allSettled(historicalRows.map(record => deleteHistoricalRun(record))).finally(() => {
                      deleteWorkflow(workflow.id)
                    })
                  }
                }}
                size="xs"
                variant="ghost"
              >
                <Trash2 className="size-3" />
                删除
              </Button>
            </div>
          </div>
        </aside>

        <main className="relative min-h-0 min-w-0 overflow-hidden">
          <ReactFlow
            connectionLineStyle={{ stroke: 'var(--ui-primary)', strokeWidth: 1.5 }}
            defaultViewport={workflow.viewport}
            key={workflow.id}
            nodes={currentNodes}
            nodeTypes={nodeTypes}
            onConnect={onConnect}
            onMoveEnd={(_event, viewport) => {
              if (!anyWorkflowBusy) {
                updateWorkflow(workflow.id, current => ({ ...current, viewport }))
              }
            }}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            onNodeDragStop={onNodeDragStop}
            onNodesChange={onNodesChange}
            onPaneClick={() => setSelectedNodeId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--ui-stroke-tertiary)" gap={24} size={1} />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              className="!bg-(--ui-editor-surface-background)"
              maskColor="color-mix(in srgb, var(--ui-chat-surface-background) 75%, transparent)"
              nodeColor="var(--ui-primary)"
              position="bottom-right"
            />
          </ReactFlow>
          {workflow.nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <GitBranch className="mx-auto mb-2 size-7 text-(--ui-text-tertiary)" />
                <p className="text-sm font-medium">从添加第一个智能体开始</p>
                <p className="mt-1 text-xs text-(--ui-text-tertiary)">拖动节点右侧圆点连接到下游智能体</p>
              </div>
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-(--ui-stroke-secondary) bg-(--ui-editor-surface-background)">
          <div className="flex h-9 shrink-0 border-b border-(--ui-stroke-tertiary) px-2">
            {(['node', 'run'] as const).map(tab => (
              <button
                className={cn('border-b-2 px-3 text-xs font-medium', panelTab === tab ? 'border-primary text-foreground' : 'border-transparent text-(--ui-text-tertiary)')}
                key={tab}
                onClick={() => setPanelTab(tab)}
                type="button"
              >
                {tab === 'node' ? '节点配置' : '运行'}
              </button>
            ))}
          </div>
          {panelTab === 'node' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selectedNode ? (
                <NodeInspector
                  activeRun={anyWorkflowBusy}
                  node={selectedNode}
                  nodes={workflow.nodes}
                  onDelete={removeSelectedNode}
                  onModelPick={() => setModelPickerNodeId(selectedNode.id)}
                  onNameChange={name => updateNode(selectedNode.id, current => ({ ...current, name }))}
                  onRoleChange={role => updateNode(selectedNode.id, current => ({ ...current, role }))}
                  onSourceChange={addUpstream}
                  workflow={workflow}
                />
              ) : (
                <div className="grid min-h-48 place-items-center text-center text-xs text-(--ui-text-tertiary)">
                  <p>选择一个节点查看角色、模型和上游连接配置</p>
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <RunInspector
                activeRun={activeRun}
                busy={anyWorkflowBusy}
                gatewayOpen={gatewayState === 'open'}
                history={historicalRows}
                historyOutput={historyOutput}
                input={taskInput}
                node={promptNode}
                onAnswer={setPromptAnswer}
                onHistorySelect={setSelectedHistoryId}
                onInput={setTaskInput}
                onRespond={(value, choice) => {
                  if (promptNode?.nodeId && value?.trim()) {
                    void respondToWorkflowPrompt(workflow.id, promptNode.nodeId, value.trim(), choice)
                    setPromptAnswer('')
                  }
                }}
                onRun={run}
                promptAnswer={promptAnswer}
                validationErrors={validation?.errors ?? []}
              />
            </div>
          )}
        </aside>
      </div>

      <ModelPickerDialog
        currentModel={selectedModel?.model ?? ''}
        currentProvider={selectedModel?.provider ?? ''}
        gw={gateway ?? activeGateway() ?? undefined}
        onOpenChange={open => {
          if (!open) {
            setModelPickerNodeId(null)
          }
        }}
        onSelect={selection => {
          if (modelPickerNodeId) {
            updateNode(modelPickerNodeId, current => ({ ...current, ...selection }))
          }

          setModelPickerNodeId(null)
        }}
        open={Boolean(selectedModel)}
      />
    </div>
  )
}

function NodeInspector({
  activeRun,
  node,
  nodes,
  onDelete,
  onModelPick,
  onNameChange,
  onRoleChange,
  onSourceChange,
  workflow
}: {
  activeRun: boolean
  node: WorkflowNode
  nodes: WorkflowNode[]
  onDelete: () => void
  onModelPick: () => void
  onNameChange: (name: string) => void
  onRoleChange: (role: string) => void
  onSourceChange: (source: string, checked: boolean) => void
  workflow: CouncilWorkflow
}) {
  const sources = nodes.filter(candidate => candidate.id !== node.id)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">节点配置</h2>
        <Button aria-label="删除节点" disabled={activeRun} onClick={onDelete} size="icon-xs" variant="ghost">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <label className="block space-y-1.5 text-xs">
        <span className="font-medium">节点名称</span>
        <Input disabled={activeRun} onChange={event => onNameChange(event.target.value.slice(0, 80))} value={node.name} />
      </label>
      <label className="block space-y-1.5 text-xs">
        <span className="font-medium">角色 <span className="text-destructive">*</span></span>
        <Textarea
          className="min-h-28 resize-y text-xs leading-relaxed"
          disabled={activeRun}
          onChange={event => onRoleChange(event.target.value.slice(0, 4_000))}
          placeholder="例如：只核查公开来源并列出证据"
          value={node.role}
        />
      </label>
      <div className="space-y-1.5 text-xs">
        <span className="font-medium">模型 <span className="text-destructive">*</span></span>
        <Button className="h-9 w-full justify-start font-mono text-xs" disabled={activeRun} onClick={onModelPick} variant="outline">
          <Brain className="size-3.5" />
          <span className="truncate">{node.model || '选择模型'}</span>
          {node.provider && <span className="ml-auto text-[0.65rem] text-(--ui-text-tertiary)">{node.provider}</span>}
        </Button>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">上游节点</legend>
        <p className="text-[0.68rem] leading-relaxed text-(--ui-text-tertiary)">勾选项会把该节点的最终成果传给当前节点。</p>
        {sources.map(source => (
          <label className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-(--ui-control-hover-background)" key={source.id}>
            <Checkbox
              checked={workflow.edges.some(edge => edge.source === source.id && edge.target === node.id)}
              disabled={activeRun}
              onCheckedChange={checked => onSourceChange(source.id, checked === true)}
            />
            <span className="truncate">{source.name}</span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}

function RunInspector({
  activeRun,
  busy,
  gatewayOpen,
  history,
  historyOutput,
  input,
  node,
  onAnswer,
  onHistorySelect,
  onInput,
  onRespond,
  onRun,
  promptAnswer,
  validationErrors
}: {
  activeRun: ReturnType<typeof activeWorkflowRun>
  busy: boolean
  gatewayOpen: boolean
  history: PersistedWorkflowRun[]
  historyOutput: string
  input: string
  node: NodeRun | null
  onAnswer: (value: string) => void
  onHistorySelect: (id: string | null) => void
  onInput: (value: string) => void
  onRespond: (value?: string, choice?: string) => void
  onRun: () => void
  promptAnswer: string
  validationErrors: string[]
}) {
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs">
        <span className="font-medium">本次任务</span>
        <Textarea
          className="min-h-28 resize-y text-xs leading-relaxed"
          disabled={busy}
          onChange={event => onInput(event.target.value)}
          placeholder="描述需要智囊团共同完成的任务"
          value={input}
        />
      </label>
      {validationErrors.length > 0 && (
        <div className="space-y-1 border-l-2 border-amber-500/70 pl-2 text-[0.68rem] text-amber-700 dark:text-amber-300">
          {validationErrors.slice(0, 5).map(error => <p key={error}>{error}</p>)}
        </div>
      )}
      <Button className="w-full" disabled={busy || !gatewayOpen || !input.trim()} onClick={onRun}>
        <Play className="size-3.5" />
        开始编排运行
      </Button>
      {activeRun && (
        <section aria-live="polite" className="space-y-2 border-t border-(--ui-stroke-tertiary) pt-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold">当前运行</h2>
            <span className="text-[0.68rem] text-(--ui-text-tertiary)">{activeRun.status}</span>
          </div>
          <div className="space-y-1">
            {Object.values(activeRun.nodeRuns).map(item => (
              <div className="flex items-center gap-2 text-[0.68rem]" key={item.nodeId}>
                <span className={cn('size-1.5 rounded-full', item.status === 'failed' ? 'bg-destructive' : item.status === 'completed' ? 'bg-emerald-500' : 'bg-primary')} />
                <span className="min-w-0 flex-1 truncate">{item.nodeName}</span>
                <span className="text-(--ui-text-tertiary)">{statusLabel[item.status]}</span>
              </div>
            ))}
          </div>
          {node?.prompt && (
            <div className="space-y-2 border-t border-amber-500/30 pt-3">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{node.prompt.kind === 'approval' ? node.prompt.description : node.prompt.kind === 'clarify' ? node.prompt.question : node.prompt.kind === 'secret' ? node.prompt.prompt : '请输入 sudo 密码'}</p>
              {node.prompt.kind === 'approval' ? (
                <div className="flex flex-wrap gap-1">
                  {['once', 'session', ...(node.prompt.allowPermanent ? ['always'] : []), 'deny'].map(choice => (
                    <Button key={choice} onClick={() => onRespond(choice, choice)} size="xs" variant={choice === 'deny' ? 'ghost' : 'outline'}>{choice}</Button>
                  ))}
                </div>
              ) : (
                <>
                  {node.prompt.kind === 'clarify' && node.prompt.choices.length > 0 && (
                    <Select onValueChange={onAnswer} value={promptAnswer}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择回答" /></SelectTrigger>
                      <SelectContent>{node.prompt.choices.map(choice => <SelectItem key={choice} value={choice}>{choice}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <Input aria-label="节点输入" onChange={event => onAnswer(event.target.value)} type={node.prompt.kind === 'secret' || node.prompt.kind === 'sudo' ? 'password' : 'text'} value={promptAnswer} />
                  <Button className="w-full" disabled={!promptAnswer.trim()} onClick={() => onRespond(promptAnswer)} size="sm">提交输入</Button>
                </>
              )}
            </div>
          )}
          {activeRun.status === 'completed' && <OutputBlock label="整体输出" text={activeRun.finalOutput} />}
          {activeRun.status === 'failed' && <OutputBlock error label="失败原因" text={activeRun.error ?? '运行失败'} />}
        </section>
      )}
      <section className="space-y-2 border-t border-(--ui-stroke-tertiary) pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold">历史运行</h2>
          <RefreshCw className="size-3.5 text-(--ui-text-tertiary)" />
        </div>
        {history.length === 0 ? (
          <p className="text-[0.68rem] text-(--ui-text-tertiary)">完成一次运行后会保留最近记录。</p>
        ) : (
          <div className="space-y-1">
            {history.map(record => (
              <button className="w-full rounded-md border border-transparent px-2 py-2 text-left text-[0.68rem] hover:bg-(--ui-control-hover-background)" key={record.id} onClick={() => onHistorySelect(record.id)} type="button">
                <span className="block truncate">{record.inputPreview || '无任务摘要'}</span>
                <span className="mt-1 block text-(--ui-text-tertiary)">{record.status} · {new Date(record.startedAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
        {historyOutput && <OutputBlock label="历史终点输出" text={historyOutput} />}
      </section>
    </div>
  )
}

function OutputBlock({ error, label, text }: { error?: boolean; label: string; text: string }) {
  return (
    <div className="space-y-1 border-t border-(--ui-stroke-tertiary) pt-3">
      <span className={cn('text-xs font-semibold', error && 'text-destructive')}>{label}</span>
      <pre className={cn('max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-(--ui-chat-surface-background) p-2 text-[0.68rem] leading-relaxed', error ? 'text-destructive' : 'text-foreground/90')}>{text || '暂无输出'}</pre>
    </div>
  )
}
