import { describe, expect, it } from 'vitest'

import { buildCouncilPrompt, referencedCouncilWindows } from './context'

describe('referencedCouncilWindows', () => {
  it('finds explicit Chinese window references and excludes the current window', () => {
    expect(referencedCouncilWindows('获取窗口3的调研结果，再结合 @窗口 2 的结论', 1)).toEqual([2, 3])
    expect(referencedCouncilWindows('继续处理窗口1的任务', 1)).toEqual([])
  })

  it('recognizes agent wording, reversed numbering, and Chinese numerals', () => {
    expect(referencedCouncilWindows('获取智囊1的上下文，再参考3号智囊和第四窗口', 2)).toEqual([1, 3, 4])
  })

  it('expands other-agent wording relative to every current agent', () => {
    expect(referencedCouncilWindows('读取其他智囊的上下文', 2)).toEqual([1, 3, 4])
    expect(referencedCouncilWindows('汇总所有窗口的结论', 4)).toEqual([1, 2, 3])
  })

  it('deduplicates repeated references', () => {
    expect(referencedCouncilWindows('窗口3和窗口 3都提到了风险', 2)).toEqual([3])
  })
})

describe('buildCouncilPrompt', () => {
  it('leaves ordinary prompts byte-for-byte unchanged', () => {
    expect(buildCouncilPrompt('分析这个方案', 1, []).prompt).toBe('分析这个方案')
  })

  it('injects only explicitly referenced window histories', () => {
    const result = buildCouncilPrompt('获取窗口3对于市场的调研结果', 1, [
      { index: 2, messages: [{ role: 'assistant', text: '窗口2内容' }] },
      {
        index: 3,
        messages: [
          { role: 'user', text: '调研市场' },
          { role: 'assistant', text: '市场增长率为 12%' }
        ]
      }
    ])

    expect(result.referencedWindows).toEqual([3])
    expect(result.prompt).toContain('<智囊团上下文 source="智囊3" index="3">')
    expect(result.prompt).toContain('用户：调研市场')
    expect(result.prompt).toContain('助手：市场增长率为 12%')
    expect(result.prompt).not.toContain('窗口2内容')
  })

  it('never substitutes agent 2 history when agents 3 and 4 request agent 1', () => {
    const sources = [
      { index: 1, messages: [{ role: 'assistant' as const, text: '仅属于智囊1的结果' }] },
      { index: 2, messages: [{ role: 'assistant' as const, text: '仅属于智囊2的结果' }] }
    ]

    for (const currentWindow of [3, 4]) {
      const result = buildCouncilPrompt('获取智囊1上下文', currentWindow, sources)

      expect(result.referencedWindows).toEqual([1])
      expect(result.prompt).toContain('仅属于智囊1的结果')
      expect(result.prompt).not.toContain('仅属于智囊2的结果')
    }
  })
})
