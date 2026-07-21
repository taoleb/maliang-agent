import type { GatewayEvent } from '@maliang/shared'

import type { MaliangGateway } from '@/maliang'
import { PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/maliang'
import { deleteSession, getSessionMessages } from '@/maliang'
import { normalizeProfileKey } from '@/store/profile'
import { resolveNewSessionCwd } from '@/store/projects'
import { $currentCwd } from '@/store/session'

import { incomingEdges, validateWorkflow } from './graph'
import { buildWorkflowPrompt } from './prompt'
import { $activeWorkflowId, $workflowRuns, createWorkflowId, makeNodeRun, saveWorkflowRunRecord, setWorkflowRun } from './store'
import {
  appendTranscriptStatus,
  appendTranscriptText,
  createNodeInputEntry,
  setTranscriptFinalText,
  upsertSubagentTranscript,
  upsertToolTranscript
} from './transcript'
import type {
  CouncilWorkflow,
  NodeRun,
  PersistedWorkflowRun,
  WorkflowPrompt,
  WorkflowRun,
} from './types'

const MAX_PARALLEL_NODES = 4
const RETRYABLE_CAP_ATTEMPTS = 5
const NODE_FINISH_FALLBACK_MS = 5_000
const SESSION_CLOSE_TIMEOUT_MS = 10_000

interface RuntimeNodeRef {
  controller: WorkflowController
  nodeId: string
}

const runtimeNodes = new Map<string, RuntimeNodeRef>()
const controllers = new Map<string, WorkflowController>()

function payloadRecord(event: GatewayEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function errorText(value: unknown): string {
  return stringValue(value).trim() || '节点执行失败'
}

function isActiveStatus(status: NodeRun['status']): boolean {
  return status === 'creating_session' || status === 'finishing' || status === 'running' || status === 'waiting_input'
}

function replaceNode(run: WorkflowRun, nodeId: string, update: (node: NodeRun) => NodeRun): WorkflowRun {
  const current = run.nodeRuns[nodeId]

  if (!current) {
    return run
  }

  return { ...run, nodeRuns: { ...run.nodeRuns, [nodeId]: update(current) } }
}

function historyOutput(messages: Array<{ role: string; content?: unknown; text?: unknown }>): string {
  const assistant = messages.filter(message => message.role === 'assistant').at(-1)

  if (!assistant) {
    return ''
  }

  const raw = assistant.text ?? assistant.content

  return typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)
}

export async function loadHistoricalNodeOutput(record: PersistedWorkflowRun, nodeId: string): Promise<string> {
  const sessionId = record.nodeSessions.find(node => node.nodeId === nodeId)?.storedSessionId

  if (!sessionId) {
    return ''
  }

  const transcript = await getSessionMessages(sessionId, record.profile)

  return historyOutput(transcript.messages)
}

export async function deleteHistoricalRun(record: PersistedWorkflowRun): Promise<void> {
  await Promise.allSettled(
    record.nodeSessions
      .map(node => node.storedSessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))
      .map(sessionId => deleteSession(sessionId, record.profile))
  )
}

export function consumeWorkflowGatewayEvent(event: GatewayEvent): boolean {
  const sessionId = event.session_id

  if (!sessionId) {
    return false
  }

  const ref = runtimeNodes.get(sessionId)

  if (!ref) {
    return false
  }

  ref.controller.handleEvent(ref.nodeId, event)

  return true
}

export function activeWorkflowProfiles(): Set<string> {
  const profiles = new Set<string>()

  for (const controller of controllers.values()) {
    if (controller.isLive()) {
      profiles.add(controller.run.profile)
    }
  }

  return profiles
}

export function activeWorkflowCount(): number {
  return [...controllers.values()].filter(controller => controller.isLive()).length
}

export function startWorkflowRun(
  workflow: CouncilWorkflow,
  input: string,
  profile: string,
  gateway: MaliangGateway
): { ok: true; run: WorkflowRun } | { errors: string[]; ok: false } {
  const validation = validateWorkflow(workflow)

  if (validation.errors.length > 0) {
    return { errors: validation.errors, ok: false }
  }

  if (activeWorkflowCount() > 0) {
    return { errors: ['已有一个编排正在运行，请先等待它结束'], ok: false }
  }

  const nodeRuns = Object.fromEntries(
    workflow.nodes.map(node => [node.id, makeNodeRun(node, incomingEdges(workflow, node.id).length ? 'pending' : 'ready')])
  )

  const run: WorkflowRun = {
    id: createWorkflowId(),
    workflowId: workflow.id,
    profile: normalizeProfileKey(profile),
    input,
    status: 'running',
    nodeRuns,
    finalNodeId: validation.sinkNodeId,
    finalOutput: '',
    error: null,
    startedAt: Date.now(),
    finishedAt: null
  }

  const controller = new WorkflowController(workflow, run, gateway)

  controllers.set(workflow.id, controller)
  $activeWorkflowId.set(workflow.id)
  controller.pump()

  return { ok: true, run }
}

export function activeWorkflowRun(workflowId: string): WorkflowRun | null {
  return $workflowRuns.get()[workflowId] ?? null
}

export async function respondToWorkflowPrompt(workflowId: string, nodeId: string, value: string, choice?: string): Promise<void> {
  await controllers.get(workflowId)?.respond(nodeId, value, choice)
}

export async function cancelWorkflowRun(workflowId: string): Promise<void> {
  await controllers.get(workflowId)?.cancel()
}

class WorkflowController {
  readonly workflow: CouncilWorkflow
  readonly gateway: MaliangGateway
  run: WorkflowRun

  private pumping = false
  private finished = false
  private capAttempts = new Map<string, number>()
  private finishingNodes = new Set<string>()
  private finishTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(workflow: CouncilWorkflow, run: WorkflowRun, gateway: MaliangGateway) {
    this.workflow = workflow
    this.run = run
    this.gateway = gateway
    setWorkflowRun(run)
  }

  isLive(): boolean {
    return !this.finished && (this.run.status === 'running' || this.run.status === 'waiting_input')
  }

  private update(update: (run: WorkflowRun) => WorkflowRun): void {
    this.run = update(this.run)
    setWorkflowRun(this.run)
  }

  private activateReadyNodes(): void {
    this.update(run => {
      let next = run

      for (const node of this.workflow.nodes) {
        const current = next.nodeRuns[node.id]

        if (!current || current.status !== 'pending') {
          continue
        }

        if (incomingEdges(this.workflow, node.id).every(edge => next.nodeRuns[edge.source]?.status === 'completed')) {
          next = replaceNode(next, node.id, item => ({ ...item, status: 'ready' }))
        }
      }

      return next
    })
  }

  pump(): void {
    if (this.finished || this.pumping) {
      return
    }

    this.pumping = true
    this.activateReadyNodes()

    try {
      const active = Object.values(this.run.nodeRuns).filter(node => isActiveStatus(node.status)).length
      const slots = Math.max(0, MAX_PARALLEL_NODES - active)

      const ready = this.workflow.nodes
        .filter(node => this.run.nodeRuns[node.id]?.status === 'ready')
        .slice(0, slots)

      for (const node of ready) {
        this.update(current => replaceNode(current, node.id, item => ({ ...item, status: 'creating_session', startedAt: Date.now() })))
        void this.launchNode(node.id)
      }

      if (this.run.status === 'running' && Object.values(this.run.nodeRuns).every(node => node.status === 'completed')) {
        this.completeRun()
      }
    } finally {
      this.pumping = false
    }
  }

  private async launchNode(nodeId: string): Promise<void> {
    const node = this.workflow.nodes.find(item => item.id === nodeId)

    if (!node || this.finished) {
      return
    }

    try {
      const cwd = $currentCwd.get().trim() || resolveNewSessionCwd() || undefined

      const created = await this.gateway.request<{
        session_id: string
        stored_session_id?: string
      }>('session.create', {
        cols: 96,
        close_on_disconnect: true,
        source: 'tool',
        title: `智囊团编排 · ${this.workflow.name} · ${node.name}`,
        ...(cwd ? { cwd } : {}),
        ...(this.run.profile ? { profile: this.run.profile } : {}),
        model: node.model,
        provider: node.provider
      })

      if (this.finished) {
        await this.gateway.request('session.close', { session_id: created.session_id }).catch(() => undefined)

        return
      }

      runtimeNodes.set(created.session_id, { controller: this, nodeId })
      this.update(run =>
        replaceNode(run, nodeId, item => ({
          ...item,
          status: 'running',
          runtimeSessionId: created.session_id,
          storedSessionId: created.stored_session_id ?? null,
          statusText: '正在提交任务'
        }))
      )

      const outputs = new Map<string, string>()

      for (const edge of incomingEdges(this.workflow, nodeId)) {
        outputs.set(edge.source, this.run.nodeRuns[edge.source]?.output ?? '')
      }

      const promptText = buildWorkflowPrompt(this.workflow, node, this.run.input, outputs)
      this.update(run =>
        replaceNode(run, nodeId, item => ({
          ...item,
          promptText,
          transcript: [createNodeInputEntry(promptText)],
          lastActivityAt: Date.now()
        }))
      )

      await this.gateway.request(
        'prompt.submit',
        { session_id: created.session_id, text: promptText },
        PROMPT_SUBMIT_REQUEST_TIMEOUT_MS
      )
    } catch (error) {
      const message = errorText(error instanceof Error ? error.message : error)
      const attempts = (this.capAttempts.get(nodeId) ?? 0) + 1

      if (message.toLowerCase().includes('active session') && attempts < RETRYABLE_CAP_ATTEMPTS) {
        this.capAttempts.set(nodeId, attempts)
        this.update(run => replaceNode(run, nodeId, item => ({ ...item, status: 'ready', statusText: '等待可用会话名额' })))
        window.setTimeout(() => this.pump(), 1_000)

        return
      }

      this.failRun(nodeId, message)
    }
  }

  handleEvent(nodeId: string, event: GatewayEvent): void {
    if (this.finished || this.run.status === 'cancelled' || this.run.status === 'completed' || this.run.status === 'failed') {
      return
    }

    const payload = payloadRecord(event)
    const runtimeId = this.run.nodeRuns[nodeId]?.runtimeSessionId

    if (!runtimeId) {
      return
    }

    if (this.run.nodeRuns[nodeId]?.status === 'finishing' && event.type !== 'session.info') {
      return
    }

    if (event.type === 'session.info' && payload.running === false && this.finishingNodes.has(nodeId)) {
      void this.finalizeNode(nodeId)

      return
    }

    if (event.type === 'message.start') {
      this.updateNodeActivity(nodeId, item => ({
        ...item,
        status: 'running',
        statusText: '正在思考',
        lastActivityAt: Date.now()
      }))

      return
    }

    if (event.type === 'message.delta') {
      const delta = stringValue(payload.text || payload.rendered || payload.message)

      if (delta) {
        this.updateNodeActivity(nodeId, item => ({
          ...item,
          output: `${item.output}${delta}`,
          status: 'running',
          transcript: appendTranscriptText(item.transcript, 'text', delta),
          lastActivityAt: Date.now()
        }))
      }

      return
    }

    if (event.type === 'thinking.delta') {
      const text = stringValue(payload.text)

      if (text) {
        this.updateNodeActivity(nodeId, item => ({
          ...item,
          statusText: text,
          transcript: appendTranscriptStatus(item.transcript, text),
          lastActivityAt: Date.now()
        }))
      }

      return
    }

    if (event.type === 'reasoning.delta' || event.type === 'reasoning.available') {
      const text = stringValue(payload.text || payload.rendered || payload.message)

      if (text) {
        this.updateNodeActivity(nodeId, item => ({
          ...item,
          status: 'running',
          transcript: appendTranscriptText(item.transcript, 'reasoning', text),
          lastActivityAt: Date.now()
        }))
      }

      return
    }

    if (event.type === 'tool.start' || event.type === 'tool.progress' || event.type === 'tool.generating') {
      this.updateNodeActivity(nodeId, item => ({
        ...item,
        status: 'running',
        statusText: `正在使用 ${stringValue(payload.name) || '工具'}`,
        transcript: upsertToolTranscript(item.transcript, event, 'running'),
        lastActivityAt: Date.now()
      }))

      return
    }

    if (event.type === 'tool.complete') {
      this.updateNodeActivity(nodeId, item => ({
        ...item,
        status: 'running',
        statusText: '继续执行',
        transcript: upsertToolTranscript(item.transcript, event, 'complete'),
        lastActivityAt: Date.now()
      }))

      return
    }

    if (event.type.startsWith('subagent.')) {
      this.updateNodeActivity(nodeId, item => ({
        ...item,
        status: 'running',
        statusText: stringValue(payload.text) || stringValue(payload.goal) || '子智能体工作中',
        transcript: upsertSubagentTranscript(item.transcript, event, event.type),
        lastActivityAt: Date.now()
      }))

      return
    }

    if (event.type === 'status.update') {
      const text = stringValue(payload.text || payload.message)

      if (text) {
        this.updateNodeActivity(nodeId, item => ({
          ...item,
          statusText: text,
          transcript: appendTranscriptStatus(item.transcript, text),
          lastActivityAt: Date.now()
        }))
      }

      return
    }

    if (event.type === 'message.complete') {
      const status = stringValue(payload.status)
      const finalText = stringValue(payload.text || payload.rendered || payload.message) || this.run.nodeRuns[nodeId]?.output || ''

      if (status && status !== 'complete') {
        this.failRun(nodeId, finalText || `节点返回状态：${status}`)
      } else {
        this.beginNodeFinishing(nodeId, finalText)
      }

      return
    }

    if (event.type === 'message.start') {
      this.update(run => replaceNode(run, nodeId, item => ({ ...item, status: 'running', statusText: '正在思考' })))
    } else if (event.type === 'message.delta') {
      const delta = stringValue(payload.text || payload.rendered || payload.message)
      this.update(run => replaceNode(run, nodeId, item => ({ ...item, output: item.output + delta, status: 'running' })))
    } else if (event.type === 'tool.start' || event.type === 'tool.progress' || event.type === 'tool.generating') {
      const toolName = stringValue(payload.name) || '工具'
      this.update(run => replaceNode(run, nodeId, item => ({ ...item, status: 'running', statusText: `正在使用 ${toolName}` })))
    } else if (event.type === 'approval.request') {
      this.setPrompt(nodeId, {
        kind: 'approval',
        allowPermanent: payload.allow_permanent !== false,
        command: stringValue(payload.command),
        description: stringValue(payload.description) || '该操作需要权限确认',
        requestId: null
      })
    } else if (event.type === 'clarify.request') {
      this.setPrompt(nodeId, {
        kind: 'clarify',
        choices: Array.isArray(payload.choices) ? payload.choices.filter((choice): choice is string => typeof choice === 'string') : [],
        question: stringValue(payload.question),
        requestId: stringValue(payload.request_id)
      })
    } else if (event.type === 'sudo.request') {
      this.setPrompt(nodeId, { kind: 'sudo', requestId: stringValue(payload.request_id) })
    } else if (event.type === 'secret.request') {
      this.setPrompt(nodeId, {
        envVar: stringValue(payload.env_var),
        kind: 'secret',
        prompt: stringValue(payload.prompt),
        requestId: stringValue(payload.request_id)
      })
    } else if (event.type === 'message.complete') {
      const status = stringValue(payload.status)
      const finalText = stringValue(payload.text || payload.rendered || payload.message) || this.run.nodeRuns[nodeId]?.output || ''

      if (status && status !== 'complete') {
        this.failRun(nodeId, finalText || `节点返回状态：${status}`)
      } else {
        void this.completeNode(nodeId, finalText)
      }
    } else if (event.type === 'error') {
      this.failRun(nodeId, errorText(payload.message))
    }
  }

  private updateNodeActivity(nodeId: string, update: (node: NodeRun) => NodeRun): void {
    this.update(run => replaceNode(run, nodeId, update))
  }

  private beginNodeFinishing(nodeId: string, finalText: string): void {
    if (this.finished || this.finishingNodes.has(nodeId)) {
      return
    }

    const current = this.run.nodeRuns[nodeId]

    if (!current || current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
      return
    }

    this.finishingNodes.add(nodeId)
    this.updateNodeActivity(nodeId, item => ({
      ...item,
      output: finalText || item.output,
      status: 'finishing',
      statusText: '正在收尾',
      transcript: setTranscriptFinalText(item.transcript, finalText || item.output),
      lastActivityAt: Date.now()
    }))

    const timer = setTimeout(() => void this.finalizeNode(nodeId), NODE_FINISH_FALLBACK_MS)
    this.finishTimers.set(nodeId, timer)
  }

  private async finalizeNode(nodeId: string): Promise<void> {
    if (this.finished || !this.finishingNodes.has(nodeId)) {
      return
    }

    this.finishingNodes.delete(nodeId)
    const timer = this.finishTimers.get(nodeId)

    if (timer) {
      clearTimeout(timer)
      this.finishTimers.delete(nodeId)
    }

    const runtimeId = this.run.nodeRuns[nodeId]?.runtimeSessionId

    if (runtimeId) {
      runtimeNodes.delete(runtimeId)
    }

    const closePromise = runtimeId
      ? this.gateway
          .request('session.close', { session_id: runtimeId }, SESSION_CLOSE_TIMEOUT_MS)
          .catch(() => undefined)
      : Promise.resolve()

    this.updateNodeActivity(nodeId, item => ({
      ...item,
      status: 'completed',
      prompt: null,
      statusText: '已完成',
      finishedAt: Date.now(),
      lastActivityAt: Date.now()
    }))
    this.pump()
    await closePromise
  }

  private setPrompt(nodeId: string, prompt: WorkflowPrompt): void {
    this.update(run => replaceNode(run, nodeId, item => ({ ...item, status: 'waiting_input', prompt, statusText: '等待输入' })))
    this.updateNodeActivity(nodeId, item => ({
      ...item,
      transcript: appendTranscriptStatus(item.transcript, '等待输入', 'warning'),
      lastActivityAt: Date.now()
    }))
    this.update(run => ({ ...run, status: 'waiting_input' }))
  }

  async respond(nodeId: string, value: string, choice?: string): Promise<void> {
    const node = this.run.nodeRuns[nodeId]
    const runtimeId = node?.runtimeSessionId
    const prompt = node?.prompt

    if (!runtimeId || !prompt) {
      return
    }

    if (prompt.kind === 'approval') {
      await this.gateway.request('approval.respond', { choice: choice ?? value, session_id: runtimeId })
    } else if (prompt.kind === 'clarify') {
      await this.gateway.request('clarify.respond', { answer: value, request_id: prompt.requestId })
    } else if (prompt.kind === 'sudo') {
      await this.gateway.request('sudo.respond', { password: value, request_id: prompt.requestId })
    } else {
      await this.gateway.request('secret.respond', { value, request_id: prompt.requestId })
    }

    this.update(run => {
      const next = replaceNode(run, nodeId, item => ({ ...item, prompt: null, status: 'running', statusText: '继续执行' }))

      return { ...next, status: 'running' }
    })
  }

  async cancel(): Promise<void> {
    if (this.finished) {
      return
    }

    this.clearFinishTimers()
    this.update(run => ({
      ...run,
      status: 'cancelled',
      finishedAt: Date.now(),
      nodeRuns: Object.fromEntries(
        Object.entries(run.nodeRuns).map(([nodeId, node]) => [
          nodeId,
          isActiveStatus(node.status)
            ? { ...node, status: 'cancelled', statusText: '已取消' }
            : node.status === 'pending' || node.status === 'ready'
              ? { ...node, status: 'blocked', statusText: '未运行' }
              : node
        ])
      )
    }))
    await this.closeAllSessions()
    this.finishRecord()
  }

  private async completeNode(nodeId: string, output: string): Promise<void> {
    const runtimeId = this.run.nodeRuns[nodeId]?.runtimeSessionId

    if (runtimeId) {
      runtimeNodes.delete(runtimeId)
      await this.gateway.request('session.close', { session_id: runtimeId }).catch(() => undefined)
    }

    this.update(run => replaceNode(run, nodeId, item => ({ ...item, status: 'completed', output, prompt: null, statusText: '已完成', finishedAt: Date.now() })))

    this.update(run => (run.status === 'waiting_input' ? { ...run, status: 'running' } : run))
    this.pump()
  }

  private failRun(nodeId: string, message: string): void {
    if (this.finished) {
      return
    }

    this.update(run => ({
      ...replaceNode(run, nodeId, item => ({ ...item, status: 'failed', error: message, statusText: '执行失败', finishedAt: Date.now() })),
      status: 'failed',
      error: message,
      finishedAt: Date.now(),
      nodeRuns: Object.fromEntries(
        Object.entries(run.nodeRuns).map(([id, node]) =>
          id === nodeId
            ? [id, { ...node, status: 'failed', error: message, statusText: '执行失败', finishedAt: Date.now() }]
            : isActiveStatus(node.status)
              ? [id, { ...node, status: 'cancelled', statusText: '因其他节点失败而停止' }]
              : node.status === 'pending' || node.status === 'ready'
                ? [id, { ...node, status: 'blocked', statusText: '因其他节点失败而跳过' }]
                : [id, node]
        )
      )
    }))
    void this.closeAllSessions().finally(() => this.finishRecord())
  }

  private completeRun(): void {
    const finalNodeId = this.run.finalNodeId
    const finalOutput = finalNodeId ? this.run.nodeRuns[finalNodeId]?.output ?? '' : ''

    this.update(run => ({ ...run, status: 'completed', finalOutput, finishedAt: Date.now() }))
    this.finishRecord()
  }

  private async closeAllSessions(): Promise<void> {
    const sessions = Object.values(this.run.nodeRuns)
      .map(node => node.runtimeSessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))

    await Promise.allSettled(
      sessions.map(sessionId => this.gateway.request('session.close', { session_id: sessionId }, SESSION_CLOSE_TIMEOUT_MS))
    )

    for (const sessionId of sessions) {
      runtimeNodes.delete(sessionId)
    }
  }

  private finishRecord(): void {
    if (this.finished) {
      return
    }

    this.finished = true
    this.clearFinishTimers()
    controllers.delete(this.workflow.id)
    saveWorkflowRunRecord(this.run)
  }

  private clearFinishTimers(): void {
    for (const timer of this.finishTimers.values()) {
      clearTimeout(timer)
    }

    this.finishTimers.clear()
    this.finishingNodes.clear()
  }
}
