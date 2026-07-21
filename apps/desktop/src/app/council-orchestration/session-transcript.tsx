import { useEffect, useState } from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'

import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { Button } from '@/components/ui/button'
import { Activity, AlertCircle, CheckCircle2, ChevronDown, Clock, Eye, EyeOff, Loader2, Wrench } from '@/lib/icons'
import { cn } from '@/lib/utils'

import type {
  NodeRun,
  NodeSubagentStatus,
  NodeTranscriptEntry,
  NodeTranscriptSubagentEntry,
  NodeTranscriptToolEntry,
  WorkflowNode
} from './types'

const statusText: Record<NodeSubagentStatus, string> = {
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
  queued: '排队中',
  running: '运行中'
}

function nodeStatusText(status: NodeRun['status']): string {
  const labels: Partial<Record<NodeRun['status'], string>> = {
    blocked: '已跳过',
    cancelled: '已取消',
    completed: '已完成',
    creating_session: '创建会话',
    failed: '失败',
    finishing: '正在收尾',
    pending: '等待上游',
    ready: '待运行',
    running: '运行中',
    waiting_input: '等待输入'
  }

  return labels[status] ?? status
}

function isNodeLive(status: NodeRun['status']): boolean {
  return status === 'creating_session' || status === 'finishing' || status === 'running' || status === 'waiting_input'
}

function elapsedText(startedAt: number | null, finishedAt: number | null, now = Date.now()): string {
  if (!startedAt) {
    return ''
  }

  const seconds = Math.max(0, Math.round(((finishedAt ?? now) - startedAt) / 1_000))

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export interface SessionTranscriptProps {
  nodes: WorkflowNode[]
  onSelectNode: (nodeId: string) => void
  onToggleFollow: () => void
  run: NodeRun | null
  selectedNodeId: string | null
  followRunningNode: boolean
}

export function SessionTranscript({
  followRunningNode,
  nodes,
  onSelectNode,
  onToggleFollow,
  run,
  selectedNodeId
}: SessionTranscriptProps) {
  const { contentRef, isAtBottom, scrollRef, scrollToBottom } = useStickToBottom({
    initial: 'instant',
    resize: 'instant'
  })

  const [hasNewActivity, setHasNewActivity] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const runLive = Boolean(run && isNodeLive(run.status))

  useEffect(() => {
    if (!runLive) {
      return
    }

    const timer = window.setInterval(() => setClock(Date.now()), 1_000)

    return () => window.clearInterval(timer)
  }, [runLive])

  useEffect(() => {
    if (isAtBottom) {
      setHasNewActivity(false)
    }
  }, [isAtBottom])

  useEffect(() => {
    if (run?.lastActivityAt && !isAtBottom) {
      setHasNewActivity(true)
    }
  }, [isAtBottom, run?.lastActivityAt])

  useEffect(() => {
    void scrollToBottom('instant')
    setHasNewActivity(false)
  }, [run?.nodeId, scrollToBottom])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-council-transcript="true">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-3">
        <Activity className="size-3.5 shrink-0 text-(--ui-text-secondary)" />
        <h2 className="shrink-0 text-xs font-semibold">运行状态</h2>
        <select
          aria-label="查看节点会话"
          className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium outline-none"
          onChange={event => onSelectNode(event.target.value)}
          value={selectedNodeId ?? ''}
        >
          <option disabled value="">
            选择节点会话
          </option>
          {nodes.map(node => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
        <Button
          aria-label={followRunningNode ? '暂停跟随运行节点' : '跟随运行节点'}
          aria-pressed={followRunningNode}
          className="size-7 shrink-0"
          onClick={onToggleFollow}
          size="icon-xs"
          title={followRunningNode ? '暂停跟随运行节点' : '跟随运行节点'}
          variant={followRunningNode ? 'secondary' : 'ghost'}
        >
          {followRunningNode ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </Button>
      </div>

      {run && (
        <div className="flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-3 py-1.5 text-[0.65rem] text-(--ui-text-tertiary)">
          <span className={cn('size-1.5 rounded-full', isNodeLive(run.status) ? 'bg-primary' : run.status === 'failed' ? 'bg-destructive' : 'bg-emerald-500')} />
          <span className="min-w-0 flex-1 truncate">{nodeStatusText(run.status)}</span>
          {run.startedAt && (
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
              <Clock className="size-3" />
              {elapsedText(run.startedAt, run.finishedAt, clock)}
            </span>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="size-full overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3" ref={scrollRef}>
          <div className="grid min-w-0 gap-3" ref={contentRef}>
            {!run ? (
              <p className="py-8 text-center text-xs text-(--ui-text-tertiary)">暂无会话活动</p>
            ) : run.transcript.length === 0 ? (
              <p className="py-8 text-center text-xs text-(--ui-text-tertiary)">正在建立会话</p>
            ) : (
              run.transcript.map(entry => <TranscriptEntryView entry={entry} key={entry.id} running={isNodeLive(run.status)} />)
            )}
          </div>
        </div>
        {hasNewActivity && !isAtBottom && (
          <Button
            aria-label="跳转到最新活动"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-sm"
            onClick={() => {
              void scrollToBottom('smooth')
              setHasNewActivity(false)
            }}
            size="xs"
            variant="secondary"
          >
            <ChevronDown className="size-3.5" />
            最新活动
          </Button>
        )}
      </div>
    </div>
  )
}

function TranscriptEntryView({ entry, running }: { entry: NodeTranscriptEntry; running: boolean }) {
  if (entry.kind === 'input') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-lg bg-(--ui-control-active-background) px-2.5 py-2 text-[0.7rem] leading-relaxed text-foreground">
          <div className="mb-1 text-[0.6rem] font-medium text-(--ui-text-tertiary)">节点输入</div>
          <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{entry.text}</pre>
        </div>
      </div>
    )
  }

  if (entry.kind === 'text') {
    return (
      <div className="min-w-0 max-w-full text-[0.74rem] leading-relaxed text-foreground">
        <CompactMarkdown text={entry.text} />
      </div>
    )
  }

  if (entry.kind === 'reasoning') {
    return (
      <details className="min-w-0 text-[0.68rem] text-(--ui-text-tertiary)" open={running}>
        <summary className="cursor-pointer list-none select-none font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3" />
            思考过程
          </span>
        </summary>
        <div className="mt-1 border-l border-(--ui-stroke-tertiary) pl-2">
          <CompactMarkdown text={entry.text} />
        </div>
      </details>
    )
  }

  if (entry.kind === 'tool') {
    return <ToolActivity entry={entry} />
  }

  if (entry.kind === 'subagent') {
    return <SubagentActivity entry={entry} />
  }

  return (
    <div className={cn('flex items-start gap-1.5 text-[0.66rem]', entry.status === 'error' && 'text-destructive', entry.status === 'warning' && 'text-amber-700 dark:text-amber-300')}>
      <Activity className="mt-0.5 size-3 shrink-0" />
      <span className="min-w-0 wrap-anywhere">{entry.text}</span>
    </div>
  )
}

function ToolActivity({ entry }: { entry: NodeTranscriptToolEntry }) {
  const [open, setOpen] = useState(false)
  const active = entry.status === 'running'
  const Icon = active ? Loader2 : entry.status === 'failed' ? AlertCircle : CheckCircle2

  return (
    <div className="min-w-0 border-l border-(--ui-stroke-tertiary) pl-2">
      <button
        aria-expanded={open}
        className="flex min-h-7 w-full min-w-0 items-start gap-1.5 text-left text-[0.68rem] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <Icon className={cn('mt-0.5 size-3 shrink-0', active && 'animate-spin', entry.status === 'failed' ? 'text-destructive' : 'text-(--ui-text-tertiary)')} />
        <span className="min-w-0 flex-1 wrap-anywhere font-medium">{entry.name}</span>
        <Wrench className="mt-0.5 size-3 shrink-0 text-(--ui-text-tertiary)" />
      </button>
      {(entry.context || entry.summary) && <p className="pl-[1.125rem] text-[0.62rem] leading-relaxed text-(--ui-text-tertiary) wrap-anywhere">{entry.summary || entry.context}</p>}
      {open && entry.detail && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-(--ui-chat-surface-background) p-2 text-[0.62rem] leading-relaxed text-(--ui-text-secondary)">{entry.detail}</pre>
      )}
    </div>
  )
}

function SubagentActivity({ entry }: { entry: NodeTranscriptSubagentEntry }) {
  const [open, setOpen] = useState(entry.status === 'running' || entry.status === 'queued')
  const active = entry.status === 'running' || entry.status === 'queued'

  useEffect(() => {
    if (active) {
      setOpen(true)
    }
  }, [active])

  return (
    <div className="min-w-0 border-l border-primary/40 pl-2">
      <button
        aria-expanded={open}
        className="flex min-h-7 w-full min-w-0 items-start gap-1.5 text-left text-[0.68rem] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        {active ? <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-primary" /> : <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />}
        <span className="min-w-0 flex-1 wrap-anywhere font-medium">{entry.goal}</span>
        <span className="shrink-0 text-[0.6rem] text-(--ui-text-tertiary)">{statusText[entry.status]}</span>
      </button>
      {entry.model && <p className="pl-[1.125rem] text-[0.6rem] text-(--ui-text-tertiary)">{entry.model}</p>}
      {open && entry.stream.length > 0 && (
        <div className="mt-1 grid gap-1 pl-[1.125rem]">
          {entry.stream.slice(-8).map((item, index) => (
            <div className={cn('wrap-anywhere text-[0.62rem] leading-relaxed', item.isError ? 'text-destructive' : 'text-(--ui-text-tertiary)')} key={`${item.at}-${item.kind}-${index}`}>
              {item.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
