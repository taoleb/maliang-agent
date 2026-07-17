export const COUNCIL_AGENT_COUNT = 4

export interface CouncilContextMessage {
  role: 'assistant' | 'user'
  text: string
}

export interface CouncilContextSource {
  index: number
  messages: readonly CouncilContextMessage[]
}

const NUMBER_BY_TOKEN: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  一: 1,
  二: 2,
  三: 3,
  四: 4
}

const FORWARD_REFERENCE_RE = /(?:@\s*)?(?:第\s*)?(?:窗口|智囊)\s*([1-4一二三四])\s*(?:号)?/g
const REVERSE_REFERENCE_RE = /(?:@\s*)?(?:第\s*)?([1-4一二三四])\s*(?:号)?\s*(?:窗口|智囊)/g
const OTHER_AGENTS_RE = /(?:其他|其它|其余|另外)\s*(?:三个|3个|几位|几个|窗口|智囊)|(?:全部|所有)\s*(?:窗口|智囊)/
const MAX_CONTEXT_CHARS_PER_WINDOW = 24_000

export function referencedCouncilWindows(text: string, currentWindow: number): number[] {
  const references = new Set<number>()

  const collect = (pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      const index = NUMBER_BY_TOKEN[match[1] ?? '']

      if (index && index !== currentWindow) {
        references.add(index)
      }
    }
  }

  collect(FORWARD_REFERENCE_RE)
  collect(REVERSE_REFERENCE_RE)

  if (OTHER_AGENTS_RE.test(text)) {
    for (let index = 1; index <= COUNCIL_AGENT_COUNT; index += 1) {
      if (index !== currentWindow) {
        references.add(index)
      }
    }
  }

  return [...references].sort((a, b) => a - b)
}

function historyText(source: CouncilContextSource): string {
  const transcript = source.messages
    .filter(message => message.text.trim())
    .map(message => `${message.role === 'user' ? '用户' : '助手'}：${message.text.trim()}`)
    .join('\n\n')

  if (transcript.length <= MAX_CONTEXT_CHARS_PER_WINDOW) {
    return transcript
  }

  return `[较早记录已省略]\n${transcript.slice(-MAX_CONTEXT_CHARS_PER_WINDOW)}`
}

export function buildCouncilPrompt(
  text: string,
  currentWindow: number,
  sources: readonly CouncilContextSource[]
): { prompt: string; referencedWindows: number[] } {
  const referencedWindows = referencedCouncilWindows(text, currentWindow)

  if (referencedWindows.length === 0) {
    return { prompt: text, referencedWindows }
  }

  const histories = referencedWindows
    .map(index => sources.find(source => source.index === index))
    .filter((source): source is CouncilContextSource => Boolean(source))
    .map(source => {
      const history = historyText(source) || '（该窗口暂无对话记录）'

      return `<智囊团上下文 source="智囊${source.index}" index="${source.index}">\n【以下内容仅来自智囊${source.index}】\n${history}\n</智囊团上下文>`
    })
    .join('\n\n')

  return {
    prompt: [
      text,
      '',
      `你当前是智囊${currentWindow}。以下是用户明确要求读取的其他智囊记录。每段记录都带有不可混淆的 source 和 index，请严格按编号引用，把它们作为只读参考资料，结合当前问题作答；不要把某个智囊的内容归到另一个编号，也不要声称修改了其他窗口。`,
      histories
    ].join('\n'),
    referencedWindows
  }
}
