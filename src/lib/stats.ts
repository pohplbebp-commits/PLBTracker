import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { AppState, DayRecord } from './storage'

export function ymd(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

export function getCompletedSessions(day: DayRecord) {
  return day.sessions.filter((s) => s.done).length
}

export function getTotalMinutes(day: DayRecord) {
  return day.sessions.filter((s) => s.done).reduce((sum, s) => sum + (s.minutes || 0), 0)
}

export function getOrZero(state: AppState, date: string) {
  const day = state.records[date]
  if (!day) return { sessions: 0, minutes: 0 }
  return { sessions: getCompletedSessions(day), minutes: getTotalMinutes(day) }
}

export function getWeekRangeContaining(date: Date) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 })
  return { weekStart, weekEnd }
}

export function listDatesInclusive(start: Date, end: Date) {
  const days = differenceInCalendarDays(end, start)
  const out: Date[] = []
  for (let i = 0; i <= days; i++) out.push(addDays(start, i))
  return out
}

export function getCurrentStreak(state: AppState, today = new Date()) {
  // Streak = consecutive days ending today where sessionsCompleted == 3
  let streak = 0
  for (let i = 0; i < 3650; i++) {
    const d = addDays(today, -i)
    const { sessions } = getOrZero(state, ymd(d))
    if (sessions === 3) streak++
    else break
  }
  return streak
}

export function getBestStreak(state: AppState) {
  const dates = Object.keys(state.records).sort()
  let best = 0
  let cur = 0
  let prev: Date | null = null
  for (const date of dates) {
    const day = state.records[date]
    const d = parseISO(date)
    const full = getCompletedSessions(day) === 3
    if (!full) {
      cur = 0
      prev = d
      continue
    }
    if (!prev) {
      cur = 1
    } else {
      const diff = differenceInCalendarDays(d, prev)
      cur = diff === 1 ? cur + 1 : 1
    }
    best = Math.max(best, cur)
    prev = d
  }
  return best
}

export function getWeeklyChallenge(state: AppState, dateInWeek: Date, targetSessions = 15) {
  const { weekStart, weekEnd } = getWeekRangeContaining(dateInWeek)
  const dates = listDatesInclusive(weekStart, weekEnd).map(ymd)
  const done = dates.reduce((sum, k) => sum + getOrZero(state, k).sessions, 0)
  return { weekStart, weekEnd, done, target: targetSessions, completed: done >= targetSessions }
}

export function getMonthMatrix(month: Date) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const end = endOfWeek(addDays(startOfMonth(addDays(month, 32)), -1), { weekStartsOn: 1 })
  const days = listDatesInclusive(start, end)
  return { start, end, days }
}

export function countTotalSessions(state: AppState) {
  return Object.values(state.records).reduce((sum, d) => sum + getCompletedSessions(d), 0)
}

export function countTotalMinutes(state: AppState) {
  return Object.values(state.records).reduce((sum, d) => sum + getTotalMinutes(d), 0)
}

export function inRange(date: string, start: string, end: string) {
  const d = parseISO(date)
  const s = parseISO(start)
  const e = parseISO(end)
  return !(isBefore(d, s) || isAfter(d, e))
}

export function getDailyCountsBetween(state: AppState, start: Date, end: Date) {
  const dates = listDatesInclusive(start, end)
  return dates.map((d) => {
    const k = ymd(d)
    const row = getOrZero(state, k)
    return { date: k, sessions: row.sessions, minutes: row.minutes }
  })
}

