import { parseISO } from 'date-fns'
import type { AppState } from './storage'
import { getCompletedSessions, getTotalMinutes } from './stats'

function esc(v: string) {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replaceAll('"', '""')}"`
  return v
}

export function makeCsv(state: AppState) {
  const header = ['patientId', 'date', 'sessionsCompleted', 'minutesTotal'].join(',')
  const dates = Object.keys(state.records).sort((a, b) => parseISO(a).getTime() - parseISO(b).getTime())
  const lines = dates.map((d) => {
    const day = state.records[d]
    const sessions = getCompletedSessions(day)
    const minutes = getTotalMinutes(day)
    return [state.patientId || '', d, String(sessions), String(minutes)].map(esc).join(',')
  })
  return [header, ...lines].join('\n')
}

export function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

