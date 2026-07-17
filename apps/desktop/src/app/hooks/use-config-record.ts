import { useQuery } from '@tanstack/react-query'

import { getMaliangConfigRecord } from '@/maliang'
import { queryClient, writeCache } from '@/lib/query-client'
import type { MaliangConfigRecord } from '@/types/maliang'

// One shared cache for the whole profile config record (`GET /api/config`).
// Every settings surface (MCP, model, config) reads and writes through this key
// so a save in one shows in the others, and revisiting a tab paints the cache
// instead of blanking on a fresh fetch.
//
// Distinct from session/hooks/use-maliang-config.ts, which is side-effecting —
// it pushes personality/cwd/voice/… into the session stores for live chat.
export const MALIANG_CONFIG_KEY = ['maliang-config-record'] as const

// staleTime 0 → serve cache instantly, background-revalidate on every mount.
export const useMaliangConfigRecord = () =>
  useQuery({ queryKey: MALIANG_CONFIG_KEY, queryFn: getMaliangConfigRecord, staleTime: 0 })

export const setMaliangConfigCache = writeCache<MaliangConfigRecord>(MALIANG_CONFIG_KEY)

export const invalidateMaliangConfig = () => queryClient.invalidateQueries({ queryKey: MALIANG_CONFIG_KEY })
