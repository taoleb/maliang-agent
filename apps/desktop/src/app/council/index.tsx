import type { GatewayEvent } from '@maliang/shared'
import { useStore } from '@nanostores/react'
import { Fragment, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'

import { isImagePath } from '@/app/chat/hooks/use-composer-actions'
import { uploadComposerAttachment } from '@/app/session/hooks/use-prompt-actions'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { ModelPickerDialog } from '@/components/model-picker'
import { PromptOverlays } from '@/components/prompt-overlays'
import { Button } from '@/components/ui/button'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { type MaliangGateway, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/maliang'
import { chatMessageText, type GatewayEventPayload, toChatMessages } from '@/lib/chat-messages'
import { attachmentId, pathLabel } from '@/lib/chat-runtime'
import { selectDesktopPaths } from '@/lib/desktop-fs'
import { Brain, FileText, RefreshCw, Send, StopFilled, Users, X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { type ComposerAttachment } from '@/store/composer'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { resolveNewSessionCwd } from '@/store/projects'
import { $connection, $currentModel, $currentProvider, $gatewayState } from '@/store/session'
import type { SessionCreateResponse, SessionResumeResponse } from '@/types/maliang'

import { buildCouncilPrompt, COUNCIL_AGENT_COUNT } from './context'

type CouncilRole = 'assistant' | 'user'

interface CouncilMessage {
  id: string
  role: CouncilRole
  text: string
  pending?: boolean
  error?: boolean
  referencedWindows?: number[]
}

type CouncilApprovalChoice = 'always' | 'deny' | 'once' | 'session'

interface CouncilApprovalRequest {
  allowPermanent: boolean
  command: string
  description: string
}

interface CouncilAgentState {
  approval: CouncilApprovalRequest | null
  approvalSubmitting: CouncilApprovalChoice | null
  attachments: ComposerAttachment[]
  index: number
  profile: string
  runtimeId: string | null
  storedSessionId: string | null
  model: string
  provider: string
  messages: CouncilMessage[]
  busy: boolean
  status: string
  error: string | null
}

interface PersistedCouncilAgent {
  index: number
  storedSessionId: string | null
  profile?: string
  model: string
  provider: string
}

interface CouncilLayout {
  row: number
  top: number
  bottom: number
}

type CouncilResizeTarget = keyof CouncilLayout

interface CouncilViewProps {
  gateway: MaliangGateway | null
  requestGateway: <T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal
  ) => Promise<T>
}

const STORAGE_KEY = 'maliang:council:v1'
const LAYOUT_STORAGE_KEY = 'maliang:council-layout:v1'
const DEFAULT_LAYOUT: CouncilLayout = { row: 50, top: 50, bottom: 50 }
const MIN_PANEL_PERCENT = 24

function clampPanelPercent(value: number): number {
  return Math.min(100 - MIN_PANEL_PERCENT, Math.max(MIN_PANEL_PERCENT, value))
}

function readPersistedLayout(): CouncilLayout {
  if (typeof window === 'undefined') {
    return DEFAULT_LAYOUT
  }

  try {
    const value = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}') as Partial<CouncilLayout>

    return {
      row: clampPanelPercent(Number(value.row) || DEFAULT_LAYOUT.row),
      top: clampPanelPercent(Number(value.top) || DEFAULT_LAYOUT.top),
      bottom: clampPanelPercent(Number(value.bottom) || DEFAULT_LAYOUT.bottom)
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function readPersistedCouncil(): PersistedCouncilAgent[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') as unknown

    if (!Array.isArray(value)) {
      return []
    }

    return value.filter((item): item is PersistedCouncilAgent => {
      if (!item || typeof item !== 'object') {
        return false
      }

      const row = item as Partial<PersistedCouncilAgent>

      return typeof row.index === 'number' && row.index >= 1 && row.index <= COUNCIL_AGENT_COUNT
    })
  } catch {
    return []
  }
}

function initialAgents(defaultModel: string, defaultProvider: string, defaultProfile: string): CouncilAgentState[] {
  const persisted = readPersistedCouncil()

  return Array.from({ length: COUNCIL_AGENT_COUNT }, (_, offset) => {
    const index = offset + 1
    const saved = persisted.find(agent => agent.index === index)

    return {
      approval: null,
      approvalSubmitting: null,
      attachments: [],
      index,
      profile: saved?.profile || defaultProfile,
      runtimeId: null,
      storedSessionId: saved?.storedSessionId ?? null,
      model: saved?.model || defaultModel,
      provider: saved?.provider || defaultProvider,
      messages: [],
      busy: false,
      status: '',
      error: null
    }
  })
}

function messageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function attachmentsForPaths(paths: readonly string[]): ComposerAttachment[] {
  return paths.map(path => {
    const kind = isImagePath(path) ? 'image' : 'file'

    return {
      id: attachmentId(kind, path),
      kind,
      label: pathLabel(path),
      detail: path,
      path
    }
  })
}

function restoredMessages(response: SessionResumeResponse): CouncilMessage[] {
  return toChatMessages(response.messages)
    .filter(message => message.role === 'assistant' || message.role === 'user')
    .map(message => ({
      id: message.id,
      role: message.role as CouncilRole,
      text: chatMessageText(message)
    }))
    .filter(message => message.text.trim())
}

function eventText(payload: GatewayEventPayload | undefined): string {
  const value = payload?.text ?? payload?.rendered ?? payload?.message

  return typeof value === 'string' ? value : ''
}

interface CouncilResizeHandleProps {
  label: string
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  orientation: 'horizontal' | 'vertical'
  value: number
}

function CouncilResizeHandle({ label, onKeyDown, onPointerDown, orientation, value }: CouncilResizeHandleProps) {
  const vertical = orientation === 'vertical'

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={100 - MIN_PANEL_PERCENT}
      aria-valuemin={MIN_PANEL_PERCENT}
      aria-valuenow={Math.round(value)}
      className={cn(
        'group/resize relative z-10 grid touch-none place-items-center outline-none [-webkit-app-region:no-drag]',
        vertical ? 'cursor-col-resize' : 'cursor-row-resize'
      )}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={0}
    >
      <span
        className={cn(
          'bg-(--ui-stroke-tertiary) transition-colors group-hover/resize:bg-primary group-focus/resize:bg-primary',
          vertical ? 'h-full w-px' : 'h-px w-full'
        )}
      />
    </div>
  )
}

export function CouncilView({ gateway, requestGateway }: CouncilViewProps) {
  const defaultModel = useStore($currentModel)
  const defaultProvider = useStore($currentProvider)
  const activeProfile = normalizeProfileKey(useStore($activeGatewayProfile))
  const gatewayOpen = useStore($gatewayState) === 'open'
  const [agents, setAgents] = useState(() => initialAgents(defaultModel, defaultProvider, activeProfile))
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [broadcastDraft, setBroadcastDraft] = useState('')
  const [broadcastAttachments, setBroadcastAttachments] = useState<ComposerAttachment[]>([])
  const [pickingTarget, setPickingTarget] = useState<string | null>(null)
  const [modelPickerAgent, setModelPickerAgent] = useState<number | null>(null)
  const [layout, setLayout] = useState(readPersistedLayout)
  const agentsRef = useRef(agents)
  const boardRef = useRef<HTMLElement | null>(null)
  const creationRefs = useRef(new Map<number, Promise<string | null>>())
  const restoreStartedRef = useRef(false)
  const scrollRefs = useRef<Array<HTMLDivElement | null>>([])

  agentsRef.current = agents

  const updateAgent = useCallback((index: number, update: (agent: CouncilAgentState) => CouncilAgentState) => {
    setAgents(current => current.map(agent => (agent.index === index ? update(agent) : agent)))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        agents.map(({ index, storedSessionId, profile, model, provider }) => ({
          index,
          storedSessionId,
          profile,
          model,
          provider
        }))
      )
    )
  }, [agents])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  }, [layout])

  useEffect(() => {
    if (!defaultModel && !defaultProvider) {
      return
    }

    setAgents(current =>
      current.map(agent => ({
        ...agent,
        model: agent.model || defaultModel,
        provider: agent.provider || defaultProvider
      }))
    )
  }, [defaultModel, defaultProvider])

  useEffect(() => {
    setAgents(current =>
      current.map(agent =>
        agent.runtimeId || agent.storedSessionId || agent.profile === activeProfile
          ? agent
          : { ...agent, profile: activeProfile }
      )
    )
  }, [activeProfile])

  useEffect(() => {
    for (const [index, node] of scrollRefs.current.entries()) {
      if (node && agents[index]?.messages.length) {
        node.scrollTop = node.scrollHeight
      }
    }
  }, [agents])

  useEffect(() => {
    if (!gateway) {
      return
    }

    return gateway.onEvent((event: GatewayEvent) => {
      const sessionId = event.session_id

      if (!sessionId) {
        return
      }

      const current = agentsRef.current.find(agent => agent.runtimeId === sessionId)

      if (!current) {
        return
      }

      const payload = event.payload as GatewayEventPayload | undefined

      updateAgent(current.index, agent => {
        if (event.type === 'message.start') {
          return { ...agent, approval: null, approvalSubmitting: null, busy: true, status: '正在思考', error: null }
        }

        if (event.type === 'message.delta') {
          const delta = eventText(payload)
          const last = agent.messages.at(-1)

          if (last?.role === 'assistant' && last.pending) {
            return {
              ...agent,
              busy: true,
              status: '正在回复',
              messages: agent.messages.map(message =>
                message.id === last.id ? { ...message, text: message.text + delta } : message
              )
            }
          }

          return {
            ...agent,
            busy: true,
            status: '正在回复',
            messages: [
              ...agent.messages,
              { id: messageId(`assistant-${agent.index}`), role: 'assistant', text: delta, pending: true }
            ]
          }
        }

        if (event.type === 'message.complete') {
          const finalText = eventText(payload)
          const last = agent.messages.at(-1)

          if (last?.role === 'assistant' && last.pending) {
            return {
              ...agent,
              approval: null,
              approvalSubmitting: null,
              busy: false,
              status: '',
              messages: agent.messages.map(message =>
                message.id === last.id ? { ...message, text: finalText || message.text, pending: false } : message
              )
            }
          }

          return {
            ...agent,
            approval: null,
            approvalSubmitting: null,
            busy: false,
            status: '',
            messages: finalText
              ? [...agent.messages, { id: messageId(`assistant-${agent.index}`), role: 'assistant', text: finalText }]
              : agent.messages
          }
        }

        if (event.type === 'session.info') {
          return {
            ...agent,
            model: typeof payload?.model === 'string' ? payload.model : agent.model,
            provider: typeof payload?.provider === 'string' ? payload.provider : agent.provider,
            busy: typeof payload?.running === 'boolean' ? payload.running : agent.busy
          }
        }

        if (event.type === 'tool.start' || event.type === 'tool.progress' || event.type === 'tool.generating') {
          const tool = typeof payload?.name === 'string' ? payload.name : '工具'

          return { ...agent, busy: true, status: `正在使用 ${tool}` }
        }

        if (event.type === 'approval.request') {
          return {
            ...agent,
            approval: {
              allowPermanent: payload?.allow_permanent !== false,
              command: typeof payload?.command === 'string' ? payload.command : '',
              description: typeof payload?.description === 'string' ? payload.description : '该操作需要授权'
            },
            approvalSubmitting: null,
            status: '等待权限确认'
          }
        }

        if (event.type === 'clarify.request' || event.type === 'secret.request') {
          return { ...agent, status: '等待确认' }
        }

        if (event.type === 'error') {
          const error = eventText(payload) || '请求失败'

          return { ...agent, approval: null, approvalSubmitting: null, busy: false, status: '', error }
        }

        return agent
      })
    })
  }, [gateway, updateAgent])

  useEffect(() => {
    if (!gatewayOpen || restoreStartedRef.current) {
      return
    }

    restoreStartedRef.current = true
    const resumable = agentsRef.current.filter(agent => agent.storedSessionId)

    for (const agent of resumable) {
      void requestGateway<SessionResumeResponse>('session.resume', {
        session_id: agent.storedSessionId,
        cols: 80,
        source: 'desktop',
        profile: agent.profile || activeProfile
      })
        .then(response => {
          updateAgent(agent.index, current => ({
            ...current,
            runtimeId: response.session_id,
            storedSessionId: response.resumed || current.storedSessionId,
            messages: restoredMessages(response),
            model: response.info?.model || current.model,
            provider: response.info?.provider || current.provider,
            busy: Boolean(response.info?.running),
            status: response.info?.running ? '正在运行' : '',
            error: null
          }))
        })
        .catch(() => {
          updateAgent(agent.index, current => ({
            ...current,
            runtimeId: null,
            storedSessionId: null,
            messages: [],
            busy: false,
            status: '',
            error: null
          }))
        })
    }
  }, [activeProfile, gatewayOpen, requestGateway, updateAgent])

  const ensureSession = useCallback(
    async (index: number): Promise<string | null> => {
      const existing = agentsRef.current.find(agent => agent.index === index)

      if (existing?.runtimeId) {
        return existing.runtimeId
      }

      const creating = creationRefs.current.get(index)

      if (creating) {
        return creating
      }

      const promise = (async () => {
        const agent = agentsRef.current.find(item => item.index === index)

        if (!agent) {
          return null
        }

        const cwd = resolveNewSessionCwd()
        const profile = agent.profile || activeProfile

        const response = await requestGateway<SessionCreateResponse>('session.create', {
          cols: 80,
          source: 'desktop',
          title: `马良智囊团 · 窗口 ${index}`,
          ...(cwd ? { cwd } : {}),
          ...(profile ? { profile } : {}),
          ...(agent.model ? { model: agent.model, ...(agent.provider ? { provider: agent.provider } : {}) } : {})
        })

        updateAgent(index, current => ({
          ...current,
          runtimeId: response.session_id,
          storedSessionId: response.stored_session_id ?? current.storedSessionId,
          profile,
          model: response.info?.model || current.model,
          provider: response.info?.provider || current.provider,
          error: null
        }))

        return response.session_id
      })()

      creationRefs.current.set(index, promise)

      try {
        return await promise
      } finally {
        creationRefs.current.delete(index)
      }
    },
    [activeProfile, requestGateway, updateAgent]
  )

  const pickBroadcastFiles = useCallback(async () => {
    setPickingTarget('broadcast')

    try {
      const paths = await selectDesktopPaths({
        title: '向四位智囊添加文件',
        defaultPath: resolveNewSessionCwd() || undefined,
        directories: false,
        multiple: true
      })

      if (!paths.length) {
        return
      }

      setBroadcastAttachments(current => {
        const existingPaths = new Set(current.map(attachment => attachment.path))

        const additions = attachmentsForPaths(paths.filter(path => !existingPaths.has(path)))

        return [...current, ...additions]
      })
    } catch (error) {
      notifyError(error, '无法添加文件')
    } finally {
      setPickingTarget(null)
    }
  }, [])

  const pickAgentFiles = useCallback(
    async (index: number) => {
      setPickingTarget(`agent:${index}`)

      try {
        const paths = await selectDesktopPaths({
          title: `向智囊 ${index} 添加文件`,
          defaultPath: resolveNewSessionCwd() || undefined,
          directories: false,
          multiple: true
        })

        if (!paths.length) {
          return
        }

        updateAgent(index, agent => {
          const existingPaths = new Set(agent.attachments.map(attachment => attachment.path))

          return {
            ...agent,
            attachments: [...agent.attachments, ...attachmentsForPaths(paths.filter(path => !existingPaths.has(path)))]
          }
        })
      } catch (error) {
        notifyError(error, '无法添加文件')
      } finally {
        setPickingTarget(null)
      }
    },
    [updateAgent]
  )

  const sendToAgent = useCallback(
    async (index: number, rawText: string, attachments: readonly ComposerAttachment[] = []): Promise<boolean> => {
      const text = rawText.trim()
      const snapshot = agentsRef.current
      const agent = snapshot.find(item => item.index === index)
      const hasAttachments = attachments.length > 0

      if ((!text && !hasAttachments) || !agent || agent.busy || !gatewayOpen) {
        return false
      }

      const visibleText = text || `请分析附件：${attachments.map(attachment => attachment.label).join('、')}`

      const { prompt, referencedWindows } = buildCouncilPrompt(
        visibleText,
        index,
        snapshot.map(item => ({ index: item.index, messages: item.messages }))
      )

      const optimistic: CouncilMessage = {
        id: messageId(`user-${index}`),
        role: 'user',
        text: visibleText,
        referencedWindows
      }

      updateAgent(index, current => ({
        ...current,
        messages: [...current.messages, optimistic],
        busy: true,
        status: '正在连接',
        error: null
      }))

      try {
        const sessionId = await ensureSession(index)

        if (!sessionId) {
          throw new Error('无法创建智囊会话')
        }

        const syncedAttachments: ComposerAttachment[] = []

        if (hasAttachments) {
          updateAgent(index, current => ({ ...current, status: '正在上传附件' }))
          const remote = $connection.get()?.mode === 'remote'

          for (const attachment of attachments) {
            syncedAttachments.push(await uploadComposerAttachment(attachment, { remote, requestGateway, sessionId }))
          }
        }

        const attachmentRefs = syncedAttachments
          .map(attachment => attachment.refText)
          .filter((ref): ref is string => Boolean(ref))
          .join('\n')

        const submitText = [attachmentRefs, prompt].filter(Boolean).join('\n\n')

        await requestGateway(
          'prompt.submit',
          { session_id: sessionId, text: submitText },
          PROMPT_SUBMIT_REQUEST_TIMEOUT_MS
        )

        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        updateAgent(index, current => ({
          ...current,
          busy: false,
          status: '',
          error: message,
          messages: [
            ...current.messages,
            { id: messageId(`error-${index}`), role: 'assistant', text: message, error: true }
          ]
        }))

        return false
      }
    },
    [ensureSession, gatewayOpen, requestGateway, updateAgent]
  )

  const sendBroadcast = useCallback(async () => {
    const text = broadcastDraft.trim()
    const attachments = broadcastAttachments

    if ((!text && attachments.length === 0) || agentsRef.current.some(agent => agent.busy)) {
      return
    }

    setBroadcastDraft('')
    setBroadcastAttachments([])
    await Promise.allSettled(agentsRef.current.map(agent => sendToAgent(agent.index, text, attachments)))
  }, [broadcastAttachments, broadcastDraft, sendToAgent])

  const sendIndividual = useCallback(
    async (index: number) => {
      const text = drafts[index]?.trim() || ''
      const attachments = agentsRef.current.find(agent => agent.index === index)?.attachments || []

      if (!text && attachments.length === 0) {
        return
      }

      setDrafts(current => ({ ...current, [index]: '' }))
      const sent = await sendToAgent(index, text, attachments)

      if (sent) {
        updateAgent(index, agent => ({ ...agent, attachments: [] }))
      }
    },
    [drafts, sendToAgent, updateAgent]
  )

  const respondToApproval = useCallback(
    async (index: number, choice: CouncilApprovalChoice) => {
      const agent = agentsRef.current.find(item => item.index === index)

      if (!agent?.runtimeId || !agent.approval || agent.approvalSubmitting) {
        return
      }

      updateAgent(index, current => ({ ...current, approvalSubmitting: choice, error: null }))

      try {
        await requestGateway('approval.respond', { choice, session_id: agent.runtimeId })
        updateAgent(index, current => ({
          ...current,
          approval: null,
          approvalSubmitting: null,
          status: '已提交权限决定'
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updateAgent(index, current => ({ ...current, approvalSubmitting: null, error: message }))
      }
    },
    [requestGateway, updateAgent]
  )

  const interruptAgent = useCallback(
    async (index: number) => {
      const agent = agentsRef.current.find(item => item.index === index)

      if (!agent?.runtimeId) {
        return
      }

      await requestGateway('session.interrupt', { session_id: agent.runtimeId }).catch(() => undefined)
      updateAgent(index, current => ({
        ...current,
        approval: null,
        approvalSubmitting: null,
        busy: false,
        status: '',
        error: null
      }))
    },
    [requestGateway, updateAgent]
  )

  const selectModel = useCallback(
    async (index: number, selection: { model: string; provider: string }) => {
      const before = agentsRef.current.find(agent => agent.index === index)

      if (!before) {
        return
      }

      updateAgent(index, agent => ({ ...agent, ...selection, error: null }))

      if (!before.runtimeId) {
        return
      }

      try {
        await requestGateway('config.set', {
          session_id: before.runtimeId,
          key: 'model',
          value: `${selection.model} --provider ${selection.provider}`
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updateAgent(index, agent => ({
          ...agent,
          model: before.model,
          provider: before.provider,
          error: `模型切换失败：${message}`
        }))
      }
    },
    [requestGateway, updateAgent]
  )

  const nudgeLayout = useCallback((target: CouncilResizeTarget, delta: number) => {
    setLayout(current => ({ ...current, [target]: clampPanelPercent(current[target] + delta) }))
  }, [])

  const startLayoutResize = useCallback((target: CouncilResizeTarget, event: PointerEvent<HTMLDivElement>) => {
    const board = boardRef.current

    if (!board) {
      return
    }

    event.preventDefault()
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = target === 'row' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const rect = board.getBoundingClientRect()

      const percent =
        target === 'row'
          ? ((moveEvent.clientY - rect.top) / rect.height) * 100
          : ((moveEvent.clientX - rect.left) / rect.width) * 100

      setLayout(current => ({ ...current, [target]: clampPanelPercent(percent) }))
    }

    const onUp = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
  }, [])

  const handleResizeKey = useCallback(
    (target: CouncilResizeTarget, event: KeyboardEvent<HTMLDivElement>) => {
      const negativeKey = target === 'row' ? 'ArrowUp' : 'ArrowLeft'
      const positiveKey = target === 'row' ? 'ArrowDown' : 'ArrowRight'

      if (event.key !== negativeKey && event.key !== positiveKey) {
        return
      }

      event.preventDefault()
      nudgeLayout(target, event.key === negativeKey ? -2 : 2)
    },
    [nudgeLayout]
  )

  const resetCouncil = useCallback(() => {
    if (!window.confirm('确定要重置四个智囊窗口吗？已有会话仍会保留在历史记录中。')) {
      return
    }

    for (const agent of agentsRef.current) {
      if (agent.runtimeId) {
        void requestGateway('session.close', { session_id: agent.runtimeId }).catch(() => undefined)
      }
    }

    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY)
    restoreStartedRef.current = true
    setDrafts({})
    setBroadcastDraft('')
    setBroadcastAttachments([])
    setLayout(DEFAULT_LAYOUT)
    setAgents(initialAgents(defaultModel, defaultProvider, activeProfile))
  }, [activeProfile, defaultModel, defaultProvider, requestGateway])

  const anyBusy = agents.some(agent => agent.busy)
  const selectedPickerAgent = modelPickerAgent ? agents.find(agent => agent.index === modelPickerAgent) : null

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background) pt-(--titlebar-height)">
      <PromptOverlays />
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-(--ui-stroke-secondary) px-4">
        <Users className="size-4 text-(--ui-text-secondary)" />
        <h1 className="text-sm font-semibold">马良智囊团</h1>
        <span className="text-[0.68rem] text-(--ui-text-tertiary)">四路独立会话</span>
        <div className="ml-auto">
          <Tip label="重置智囊团">
            <Button aria-label="重置智囊团" onClick={resetCouncil} size="icon-sm" variant="ghost">
              <RefreshCw className="size-3.5" />
            </Button>
          </Tip>
        </div>
      </header>

      <main
        className="grid min-h-0 flex-1 overflow-hidden p-2"
        ref={boardRef}
        style={{ gridTemplateRows: `minmax(0, ${layout.row}fr) 6px minmax(0, ${100 - layout.row}fr)` }}
      >
        {[0, 1].map(rowIndex => {
          const splitTarget: CouncilResizeTarget = rowIndex === 0 ? 'top' : 'bottom'
          const rowAgents = agents.slice(rowIndex * 2, rowIndex * 2 + 2)

          return (
            <Fragment key={`row-${rowIndex}`}>
              <div
                className="grid min-h-0 min-w-0 overflow-hidden"
                style={{
                  gridTemplateColumns: `minmax(0, ${layout[splitTarget]}fr) 6px minmax(0, ${100 - layout[splitTarget]}fr)`
                }}
              >
                {rowAgents.map((agent, offset) => (
                  <Fragment key={agent.index}>
                    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-editor-surface-background)">
                      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-2.5">
                        <span className="grid size-5 shrink-0 place-items-center rounded bg-(--ui-control-active-background) text-[0.68rem] font-semibold">
                          {agent.index}
                        </span>
                        <span className="text-xs font-medium">智囊 {agent.index}</span>
                        {agent.busy && (
                          <GlyphSpinner
                            ariaLabel="正在运行"
                            className="size-3 text-(--ui-text-tertiary)"
                            spinner="breathe"
                          />
                        )}
                        <Button
                          className="ml-auto h-6 max-w-[48%] gap-1 px-2 font-mono text-[0.65rem]"
                          disabled={!gatewayOpen || agent.busy}
                          onClick={() => setModelPickerAgent(agent.index)}
                          variant="ghost"
                        >
                          <Brain className="size-3 shrink-0" />
                          <span className="truncate">{agent.model || '选择模型'}</span>
                        </Button>
                      </div>

                      <div
                        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5"
                        ref={node => {
                          scrollRefs.current[agent.index - 1] = node
                        }}
                      >
                        {agent.messages.length === 0 ? (
                          <div className="grid h-full place-items-center text-[0.72rem] text-(--ui-text-tertiary)">
                            等待提问
                          </div>
                        ) : (
                          agent.messages.map(message => (
                            <div
                              className={cn('flex min-w-0', message.role === 'user' ? 'justify-end' : 'justify-start')}
                              key={message.id}
                            >
                              <div
                                className={cn(
                                  'max-w-[92%] rounded-md px-2.5 py-2 text-xs leading-relaxed wrap-anywhere',
                                  message.role === 'user'
                                    ? 'bg-(--ui-control-active-background) text-foreground'
                                    : 'border-l-2 border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background)',
                                  message.error && 'border-destructive/60 text-destructive'
                                )}
                              >
                                {message.role === 'assistant' ? (
                                  <CompactMarkdown className="text-foreground/90" text={message.text || '…'} />
                                ) : (
                                  <>
                                    <p className="whitespace-pre-wrap">{message.text}</p>
                                    {Boolean(message.referencedWindows?.length) && (
                                      <p className="mt-1 text-[0.62rem] text-(--ui-text-tertiary)">
                                        已引用窗口 {message.referencedWindows?.join('、')}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {agent.approval && (
                        <div className="shrink-0 border-t border-amber-500/35 bg-amber-500/8 px-2.5 py-2 text-xs">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span className="font-medium text-foreground">需要权限确认</span>
                            {agent.approvalSubmitting && (
                              <GlyphSpinner
                                ariaLabel="正在提交权限决定"
                                className="size-3 text-(--ui-text-tertiary)"
                                spinner="breathe"
                              />
                            )}
                          </div>
                          {agent.approval.description && (
                            <p className="mt-1 text-[0.68rem] leading-snug text-(--ui-text-secondary)">
                              {agent.approval.description}
                            </p>
                          )}
                          {agent.approval.command && (
                            <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) px-2 py-1.5 font-mono text-[0.65rem] leading-snug text-foreground">
                              {agent.approval.command}
                            </pre>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Button
                              disabled={Boolean(agent.approvalSubmitting)}
                              onClick={() => void respondToApproval(agent.index, 'once')}
                              size="xs"
                            >
                              允许一次
                            </Button>
                            <Button
                              disabled={Boolean(agent.approvalSubmitting)}
                              onClick={() => void respondToApproval(agent.index, 'session')}
                              size="xs"
                              variant="ghost"
                            >
                              本会话允许
                            </Button>
                            {agent.approval.allowPermanent && (
                              <Button
                                disabled={Boolean(agent.approvalSubmitting)}
                                onClick={() => void respondToApproval(agent.index, 'always')}
                                size="xs"
                                variant="ghost"
                              >
                                始终允许
                              </Button>
                            )}
                            <Button
                              disabled={Boolean(agent.approvalSubmitting)}
                              onClick={() => void respondToApproval(agent.index, 'deny')}
                              size="xs"
                              variant="ghost"
                            >
                              拒绝
                            </Button>
                          </div>
                        </div>
                      )}

                      {(agent.status || agent.error) && (
                        <div
                          className={cn(
                            'shrink-0 truncate border-t border-(--ui-stroke-tertiary) px-2.5 py-1 text-[0.65rem]',
                            agent.error ? 'text-destructive' : 'text-(--ui-text-tertiary)'
                          )}
                        >
                          {agent.error || agent.status}
                        </div>
                      )}

                      {agent.attachments.length > 0 && (
                        <div className="flex shrink-0 flex-wrap gap-1 border-t border-(--ui-stroke-tertiary) px-2 py-1.5">
                          {agent.attachments.map(attachment => (
                            <div
                              className="flex h-6 max-w-44 items-center gap-1 rounded border border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) px-1.5 text-[0.65rem]"
                              key={attachment.id}
                            >
                              <FileText className="size-3 shrink-0 text-(--ui-text-tertiary)" />
                              <span className="min-w-0 flex-1 truncate">{attachment.label}</span>
                              <button
                                aria-label={`移除 ${attachment.label}`}
                                className="grid size-3.5 shrink-0 place-items-center text-(--ui-text-tertiary) hover:text-foreground"
                                onClick={() =>
                                  updateAgent(agent.index, current => ({
                                    ...current,
                                    attachments: current.attachments.filter(item => item.id !== attachment.id)
                                  }))
                                }
                                type="button"
                              >
                                <X className="size-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex shrink-0 items-end gap-1.5 border-t border-(--ui-stroke-tertiary) p-2">
                        <Textarea
                          aria-label={`窗口 ${agent.index} 输入框`}
                          className="max-h-24 min-h-8 resize-none py-1.5 text-xs"
                          disabled={!gatewayOpen || agent.busy}
                          onChange={event => setDrafts(current => ({ ...current, [agent.index]: event.target.value }))}
                          onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                              event.preventDefault()
                              void sendIndividual(agent.index)
                            }
                          }}
                          placeholder={`向智囊 ${agent.index} 提问`}
                          rows={1}
                          value={drafts[agent.index] || ''}
                        />
                        <Tip label={`向智囊 ${agent.index} 添加文件`}>
                          <Button
                            aria-label={`向智囊 ${agent.index} 添加文件`}
                            disabled={!gatewayOpen || agent.busy || pickingTarget !== null}
                            onClick={() => void pickAgentFiles(agent.index)}
                            size="icon-sm"
                            variant="ghost"
                          >
                            {pickingTarget === `agent:${agent.index}` ? (
                              <GlyphSpinner ariaLabel="正在选择文件" className="size-3.5" spinner="breathe" />
                            ) : (
                              <FileText className="size-3.5" />
                            )}
                          </Button>
                        </Tip>
                        {agent.busy ? (
                          <Tip label={`停止智囊 ${agent.index}`}>
                            <Button
                              aria-label={`停止智囊 ${agent.index}`}
                              onClick={() => void interruptAgent(agent.index)}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <StopFilled className="size-3.5" />
                            </Button>
                          </Tip>
                        ) : (
                          <Tip label={`发送到智囊 ${agent.index}`}>
                            <Button
                              aria-label={`发送到智囊 ${agent.index}`}
                              disabled={
                                !gatewayOpen || (!drafts[agent.index]?.trim() && agent.attachments.length === 0)
                              }
                              onClick={() => void sendIndividual(agent.index)}
                              size="icon-sm"
                            >
                              <Send className="size-3.5" />
                            </Button>
                          </Tip>
                        )}
                      </div>
                    </section>
                    {offset === 0 && (
                      <CouncilResizeHandle
                        label={`调整第 ${rowIndex + 1} 行智囊窗口宽度`}
                        onKeyDown={event => handleResizeKey(splitTarget, event)}
                        onPointerDown={event => startLayoutResize(splitTarget, event)}
                        orientation="vertical"
                        value={layout[splitTarget]}
                      />
                    )}
                  </Fragment>
                ))}
              </div>
              {rowIndex === 0 && (
                <CouncilResizeHandle
                  label="调整上下两行智囊窗口高度"
                  onKeyDown={event => handleResizeKey('row', event)}
                  onPointerDown={event => startLayoutResize('row', event)}
                  orientation="horizontal"
                  value={layout.row}
                />
              )}
            </Fragment>
          )
        })}
      </main>

      <footer className="shrink-0 border-t border-(--ui-stroke-secondary) bg-(--ui-editor-surface-background) p-2.5">
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          {broadcastAttachments.length > 0 && (
            <div aria-label="待发送文件" className="flex min-w-0 flex-wrap gap-1.5">
              {broadcastAttachments.map(attachment => (
                <div
                  className="flex h-7 max-w-56 items-center gap-1.5 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) px-2 text-[0.68rem]"
                  key={attachment.id}
                >
                  <FileText className="size-3 shrink-0 text-(--ui-text-tertiary)" />
                  <span className="min-w-0 flex-1 truncate">{attachment.label}</span>
                  <Tip label={`移除 ${attachment.label}`}>
                    <button
                      aria-label={`移除 ${attachment.label}`}
                      className="grid size-4 shrink-0 place-items-center text-(--ui-text-tertiary) hover:text-foreground"
                      onClick={() =>
                        setBroadcastAttachments(current => current.filter(item => item.id !== attachment.id))
                      }
                      type="button"
                    >
                      <X className="size-3" />
                    </button>
                  </Tip>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Tip label="添加文件">
              <Button
                aria-label="添加文件"
                disabled={!gatewayOpen || anyBusy || pickingTarget !== null}
                onClick={() => void pickBroadcastFiles()}
                size="icon"
                variant="ghost"
              >
                {pickingTarget === 'broadcast' ? (
                  <GlyphSpinner ariaLabel="正在选择文件" className="size-4" spinner="breathe" />
                ) : (
                  <FileText className="size-4" />
                )}
              </Button>
            </Tip>
            <Textarea
              aria-label="智囊团统一输入框"
              className="max-h-32 min-h-10 resize-none text-sm"
              disabled={!gatewayOpen || anyBusy}
              onChange={event => setBroadcastDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void sendBroadcast()
                }
              }}
              placeholder="同时向四位智囊提问"
              rows={1}
              value={broadcastDraft}
            />
            <Tip label="发送给四位智囊">
              <Button
                aria-label="发送给四位智囊"
                disabled={!gatewayOpen || anyBusy || (!broadcastDraft.trim() && broadcastAttachments.length === 0)}
                onClick={() => void sendBroadcast()}
                size="icon"
              >
                <Send className="size-4" />
              </Button>
            </Tip>
          </div>
        </div>
      </footer>

      {selectedPickerAgent && (
        <ModelPickerDialog
          currentModel={selectedPickerAgent.model}
          currentProvider={selectedPickerAgent.provider}
          gw={gateway || undefined}
          onOpenChange={open => {
            if (!open) {
              setModelPickerAgent(null)
            }
          }}
          onSelect={selection => void selectModel(selectedPickerAgent.index, selection)}
          open
          sessionId={selectedPickerAgent.runtimeId}
        />
      )}
    </div>
  )
}
