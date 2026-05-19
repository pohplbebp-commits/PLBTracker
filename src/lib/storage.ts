export type SessionId = 1 | 2 | 3

export type SessionRecord = {
  id: SessionId
  done: boolean
  minutes: number
  startedAt?: string // ISO
  completedAt?: string // ISO
  endedAt?: string // ISO (when timer finishes or user marks complete)
}

export type DayRecord = {
  date: string // yyyy-MM-dd
  sessions: SessionRecord[]
}

export type Settings = {
  appsScriptUrl?: string
  appsScriptSecret?: string
  lastSyncedWeekEnd?: string // yyyy-MM-dd
}

export type AppState = {
  version: 1
  patientId?: string
  settings: Settings
  records: Record<string, DayRecord> // key = date
}

const STORAGE_KEY = 'plb_tracker_v1'

export function makeEmptyState(): AppState {
  return {
    version: 1,
    patientId: undefined,
    settings: {},
    records: {},
  }
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return makeEmptyState()
    const parsed = JSON.parse(raw) as AppState
    if (!parsed || parsed.version !== 1) return makeEmptyState()
    if (!parsed.settings) parsed.settings = {}
    if (!parsed.records) parsed.records = {}
    return parsed
  } catch {
    return makeEmptyState()
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function ensureDayRecord(state: AppState, date: string): DayRecord {
  const existing = state.records[date]
  if (existing?.sessions?.length === 3) return existing

  const baseSessions: SessionRecord[] = ([1, 2, 3] as const).map((id) => ({
    id,
    done: false,
    minutes: 5,
  }))

  const merged: DayRecord = {
    date,
    sessions:
      existing?.sessions?.length
        ? baseSessions.map((s) => {
            const prev = existing.sessions.find((x) => x.id === s.id)
            return prev ? { ...s, ...prev } : s
          })
        : baseSessions,
  }

  state.records[date] = merged
  return merged
}
