import { useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import {
  addMonths,
  format,
  isSameMonth,
  parseISO,
  startOfDay,
  subMonths,
} from 'date-fns'
import { downloadTextFile, makeCsv } from './lib/exportCsv'
import { loadState, saveState, ensureDayRecord, type AppState, type SessionId } from './lib/storage'
import {
  countTotalMinutes,
  countTotalSessions,
  getBestStreak,
  getCompletedSessions,
  getCurrentStreak,
  getMonthMatrix,
  getOrZero,
  getWeeklyChallenge,
  listDatesInclusive,
  ymd,
} from './lib/stats'
import { getWeekEndForAutoSync, getWeekEndForManualSync, syncWeekToAppsScript } from './lib/sync'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

type Badge = {
  id: string
  title: string
  desc: string
  unlocked: (s: AppState) => boolean
}

const BADGES: Badge[] = [
  {
    id: 'first',
    title: '第一次完成',
    desc: '完成任何一節呼吸練習',
    unlocked: (s) => countTotalSessions(s) >= 1,
  },
  {
    id: 'streak7',
    title: '7日連續',
    desc: '連續 7 天完成每日 3 次',
    unlocked: (s) => getBestStreak(s) >= 7,
  },
  {
    id: 'streak14',
    title: '14日連續',
    desc: '連續 14 天完成每日 3 次',
    unlocked: (s) => getBestStreak(s) >= 14,
  },
  {
    id: 'sessions30',
    title: '累積 30 次',
    desc: '總共完成 30 節練習',
    unlocked: (s) => countTotalSessions(s) >= 30,
  },
  {
    id: 'minutes300',
    title: '累積 300 分鐘',
    desc: '總練習時間達 300 分鐘',
    unlocked: (s) => countTotalMinutes(s) >= 300,
  },
  {
    id: 'challenge',
    title: '每週挑戰達成',
    desc: '完成本週挑戰（15 節）',
    unlocked: (s) => getWeeklyChallenge(s, new Date()).completed,
  },
]

function clampMinutes(v: number) {
  if (Number.isNaN(v)) return 5
  return Math.max(5, Math.min(10, Math.round(v)))
}

function fmtMMSS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [toast, setToast] = useState<string | null>(null)
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfDay(new Date()))
  const [nowTick, setNowTick] = useState<number>(() => Date.now())
  const [running, setRunning] = useState<null | { date: string; sessionId: SessionId }>(null)
  const [activeSession, setActiveSession] = useState<SessionId>(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminUnlocked, setAdminUnlocked] = useState(false)

  const todayKey = ymd(new Date())
  useEffect(() => {
    setState((prev) => {
      const existing = prev.records[todayKey]
      if (existing?.sessions?.length === 3) return prev
      const next = structuredClone(prev)
      ensureDayRecord(next, todayKey)
      return next
    })
  }, [todayKey])

  const todayRecord = useMemo(() => {
    const existing = state.records[todayKey]
    if (existing?.sessions?.length === 3) return existing
    return {
      date: todayKey,
      sessions: ([1, 2, 3] as const).map((id) => ({ id, done: false, minutes: 5 })),
    }
  }, [state.records, todayKey])

  // Keep UI focused on 1 exercise at a time:
  // Prefer running session → first incomplete → last session.
  useEffect(() => {
    const rec = state.records[todayKey] || todayRecord
    const runningId = running?.date === todayKey ? running.sessionId : undefined
    if (runningId) {
      setActiveSession(runningId)
      return
    }
    const firstIncomplete = rec.sessions.find((s) => !s.done)?.id
    setActiveSession(firstIncomplete || 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, running?.sessionId, state.records])

  // Timer tick (only while a session is running)
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNowTick(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [running])

  // If a session has started (startedAt exists) but app refreshed, resume it.
  useEffect(() => {
    if (running) return
    const rec = state.records[todayKey]
    if (!rec) return
    const candidate = rec.sessions.find((s) => !!s.startedAt && !s.done)
    if (candidate) setRunning({ date: todayKey, sessionId: candidate.id })
  }, [running, state.records, todayKey])

  useEffect(() => {
    saveState(state)
  }, [state])

  // Best-effort weekly auto-sync (runs when the user opens the app on/after Sunday).
  useEffect(() => {
    let cancelled = false
    async function run() {
      const url = state.settings.appsScriptUrl?.trim()
      if (!url) return
      if (!state.patientId) return

      const weekEnd = getWeekEndForAutoSync(new Date())
      const weekEndKey = format(weekEnd, 'yyyy-MM-dd')
      if (state.settings.lastSyncedWeekEnd === weekEndKey) return

      const res = await syncWeekToAppsScript(state, weekEnd)
      if (cancelled) return
      if (res.ok) {
        setState((prev) => ({
          ...prev,
          settings: { ...prev.settings, lastSyncedWeekEnd: weekEndKey },
        }))
        setToast('已自動同步到 Google Sheets（本週）')
      } else {
        setToast(res.message)
      }
    }
    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const todayDone = getCompletedSessions(state.records[todayKey] || todayRecord)
  const currentStreak = getCurrentStreak(state)
  const bestStreak = getBestStreak(state)
  const weeklyChallenge = getWeeklyChallenge(state, new Date(), 15)

  const weeklyDates = useMemo(() => {
    const days = listDatesInclusive(weeklyChallenge.weekStart, weeklyChallenge.weekEnd)
    return days.map((d) => ymd(d))
  }, [weeklyChallenge.weekEnd, weeklyChallenge.weekStart])

  const weeklyBar = useMemo(() => {
    const labels = weeklyDates.map((d) => format(parseISO(d), 'E'))
    const data = weeklyDates.map((d) => getOrZero(state, d).sessions)
    return {
      labels,
      datasets: [
        {
          label: '次數（0-3）',
          data,
          backgroundColor: 'rgba(45, 212, 191, 0.55)',
          borderColor: 'rgba(45, 212, 191, 0.9)',
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    }
  }, [state, weeklyDates])

  const monthMatrix = useMemo(() => getMonthMatrix(monthCursor), [monthCursor])

  const unlockedBadgeIds = useMemo(() => {
    const set = new Set<string>()
    for (const b of BADGES) if (b.unlocked(state)) set.add(b.id)
    return set
  }, [state])

  function setPatientId(patientId: string) {
    setState((prev) => ({ ...prev, patientId: patientId.trim() }))
  }

  function toggleSession(sessionId: SessionId, done: boolean) {
    setState((prev) => {
      const next = structuredClone(prev)
      const day = ensureDayRecord(next, todayKey)
      const s = day.sessions.find((x) => x.id === sessionId)!
      s.done = done
      if (done) {
        const t = new Date().toISOString()
        s.completedAt = t
        s.endedAt = t
        delete s.startedAt
      } else {
        delete s.completedAt
        delete s.endedAt
        delete s.startedAt
      }
      return next
    })
  }

  function setSessionMinutes(sessionId: SessionId, minutes: number) {
    setState((prev) => {
      const next = structuredClone(prev)
      const day = ensureDayRecord(next, todayKey)
      const s = day.sessions.find((x) => x.id === sessionId)!
      s.minutes = clampMinutes(minutes)
      return next
    })
  }

  function startTimer(sessionId: SessionId) {
    // Only allow one running session at a time
    setState((prev) => {
      const next = structuredClone(prev)
      const day = ensureDayRecord(next, todayKey)
      for (const ss of day.sessions) {
        if (ss.id !== sessionId) delete ss.startedAt
      }
      const s = day.sessions.find((x) => x.id === sessionId)!
      const t = new Date().toISOString()
      s.startedAt = t
      s.done = false
      delete s.completedAt
      delete s.endedAt
      return next
    })
    setRunning({ date: todayKey, sessionId })
    setActiveSession(sessionId)
    setToast(null)
  }

  function stopTimer(sessionId: SessionId) {
    setState((prev) => {
      const next = structuredClone(prev)
      const day = ensureDayRecord(next, todayKey)
      const s = day.sessions.find((x) => x.id === sessionId)!
      delete s.startedAt
      return next
    })
    setRunning(null)
  }

  function resetTodayAll() {
    setState((prev) => {
      const next = structuredClone(prev)
      const day = ensureDayRecord(next, todayKey)
      for (const s of day.sessions) {
        s.done = false
        delete s.startedAt
        delete s.completedAt
        delete s.endedAt
      }
      return next
    })
    setRunning(null)
    setToast('已重設今日記錄。')
  }

  function requestAdminUnlock() {
    // 注意：這只是最基本的本機保護（不屬於安全登入機制）
    const input = window.prompt('請輸入管理員密碼')
    if (input === 'phoniv') {
      setAdminUnlocked(true)
      setSettingsOpen(true)
      setToast('已解鎖設定。')
    } else if (input !== null) {
      setToast('密碼錯誤，無法開啟設定。')
    }
  }

  function markDone(sessionId: SessionId) {
    toggleSession(sessionId, true)
    if (running?.sessionId === sessionId) setRunning(null)
    setToast(`第 ${sessionId} 次已完成！`)
    // Auto-advance to next incomplete session
    setTimeout(() => {
      setState((prev) => {
        const rec = prev.records[todayKey]
        if (!rec) return prev
        const nextId = rec.sessions.find((s) => !s.done)?.id
        if (nextId) setActiveSession(nextId)
        return prev
      })
    }, 0)
  }

  const runningInfo = useMemo(() => {
    const rec = state.records[todayKey]
    if (!rec || !running || running.date !== todayKey) return null
    const s = rec.sessions.find((x) => x.id === running.sessionId)
    if (!s?.startedAt) return null
    const startMs = Date.parse(s.startedAt)
    const total = (s.minutes || 5) * 60
    const elapsed = Math.max(0, Math.floor((nowTick - startMs) / 1000))
    const remaining = total - elapsed
    return { sessionId: s.id, startMs, total, elapsed, remaining }
  }, [nowTick, running, state.records, todayKey])

  // Auto-complete when countdown ends
  useEffect(() => {
    if (!runningInfo) return
    if (runningInfo.remaining > 0) return
    markDone(runningInfo.sessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningInfo?.remaining])

  async function manualSync() {
    const weekEnd = getWeekEndForManualSync(new Date())
    const weekEndKey = format(weekEnd, 'yyyy-MM-dd')
    const res = await syncWeekToAppsScript(state, weekEnd)
    if (res.ok) {
      setState((prev) => ({
        ...prev,
        settings: { ...prev.settings, lastSyncedWeekEnd: weekEndKey },
      }))
      setToast('同步完成。')
    } else {
      setToast(res.message)
    }
  }

  function exportCsv() {
    const csv = makeCsv(state)
    const fname = `PLB_${state.patientId || 'patient'}_${todayKey}.csv`
    downloadTextFile(fname, csv, 'text/csv;charset=utf-8')
    setToast('已匯出 CSV。')
  }

  const showSetup = !state.patientId

  return (
    <>
      <div className="appShell">
        <div className="topbar">
          <div>
            <div className="title">縮唇呼吸練習記錄</div>
            <div className="subtle">
              每日 3 次 · 每次 5–10 分鐘 · 病人編號：{state.patientId ? state.patientId : '未設定'}
            </div>
          </div>
          <div className="chip">
            連續 {currentStreak} 天 <span className="tiny">(最高 {bestStreak})</span>
          </div>
        </div>

        {toast ? (
          <div className="card" style={{ borderColor: 'rgba(98, 209, 255, 0.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>{toast}</div>
              <button className="btn btnGhost" onClick={() => setToast(null)}>
                關閉
              </button>
            </div>
          </div>
        ) : null}

        {showSetup ? (
          <SetupCard onSave={setPatientId} />
        ) : (
          <>
            {/* 今日（主要畫面） */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 20 }}>今日（{format(new Date(), 'M月d日')}）</div>
                  <div className="tiny">完成 3 次可累積連續天數</div>
                </div>
                <div className="progressDots" aria-label="今日完成度">
                  <span className={`dot ${todayDone >= 1 ? 'dotOn' : ''}`} />
                  <span className={`dot ${todayDone >= 2 ? 'dotOn' : ''}`} />
                  <span className={`dot ${todayDone >= 3 ? 'dotOn' : ''}`} />
                </div>
              </div>

              <div className="hr" />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <button
                  className="btn"
                  onClick={() => setActiveSession((s) => (s > 1 ? ((s - 1) as SessionId) : s))}
                  disabled={activeSession === 1}
                >
                  上一個
                </button>
                <div className="chip" style={{ fontSize: 16, padding: '10px 14px' }}>
                  第 {activeSession} 次 / 3
                </div>
                <button
                  className="btn"
                  onClick={() => setActiveSession((s) => (s < 3 ? ((s + 1) as SessionId) : s))}
                  disabled={activeSession === 3}
                >
                  下一個
                </button>
              </div>

              {/* 時間選擇：只提供 5 / 10 分鐘 */}
              <div className="hr" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div className="tiny">本次時間</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className={`btn ${
                      (todayRecord.sessions.find((s) => s.id === activeSession)?.minutes || 5) === 5
                        ? 'btnPrimary'
                        : ''
                    }`}
                    onClick={() => setSessionMinutes(activeSession, 5)}
                    disabled={running?.date === todayKey && running.sessionId === activeSession}
                    style={{ minWidth: 110 }}
                  >
                    5 分鐘
                  </button>
                  <button
                    className={`btn ${
                      (todayRecord.sessions.find((s) => s.id === activeSession)?.minutes || 5) === 10
                        ? 'btnPrimary'
                        : ''
                    }`}
                    onClick={() => setSessionMinutes(activeSession, 10)}
                    disabled={running?.date === todayKey && running.sessionId === activeSession}
                    style={{ minWidth: 110 }}
                  >
                    10 分鐘
                  </button>
                </div>
              </div>

              <SessionRow
                title={`第 ${activeSession} 次`}
                sessionId={activeSession}
                record={todayRecord}
                onStart={startTimer}
                onStop={stopTimer}
                runningInfo={runningInfo}
              />
            </div>

            {/*（可選）進度：預設收合，方便長者使用 */}
            <details className="card">
              <summary style={{ fontWeight: 900, fontSize: 18, cursor: 'pointer' }}>進度（可展開）</summary>
              <div className="hr" />
              <div className="row">
                <div className="card" style={{ boxShadow: 'none', padding: 12 }}>
                  <div className="subtle">今日</div>
                  <div style={{ fontSize: 28, fontWeight: 950 }}>{todayDone}/3</div>
                </div>
                <div className="card" style={{ boxShadow: 'none', padding: 12 }}>
                  <div className="subtle">本週累計</div>
                  <div style={{ fontSize: 28, fontWeight: 950 }}>{weeklyChallenge.done}</div>
                </div>
              </div>
              <div style={{ height: 220, marginTop: 12 }}>
                <Bar
                  data={weeklyBar}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { suggestedMin: 0, suggestedMax: 3, ticks: { stepSize: 1 } } },
                  }}
                />
              </div>

              <div className="hr" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 850 }}>月曆</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setMonthCursor((d) => subMonths(d, 1))}>
                    上月
                  </button>
                  <button className="btn" onClick={() => setMonthCursor((d) => addMonths(d, 1))}>
                    下月
                  </button>
                </div>
              </div>
              <div className="tiny" style={{ marginTop: 6 }}>
                {format(monthCursor, 'yyyy年M月')}（0–3 次）
              </div>
              <div className="hr" />
              <div className="grid7" style={{ marginBottom: 6 }}>
                {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
                  <div key={d} className="tiny" style={{ textAlign: 'center' }}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid7">
                {monthMatrix.days.map((d) => {
                  const k = ymd(d)
                  const v = getOrZero(state, k).sessions
                  const heat = `heat${Math.max(0, Math.min(3, v))}`
                  const muted = isSameMonth(d, monthCursor) ? '' : 'opacity:0.45;'
                  return (
                    <div
                      key={k}
                      className={`dayCell ${heat}`}
                      style={muted ? ({ opacity: 0.45 } as React.CSSProperties) : undefined}
                      title={`${k}：${v}/3`}
                    >
                      <div style={{ fontWeight: 850, color: 'rgba(255,255,255,0.9)' }}>{format(d, 'd')}</div>
                      <div className="tiny">{v}/3</div>
                    </div>
                  )
                })}
              </div>
            </details>

            {/*（可選）獎勵 */}
            <details className="card">
              <summary style={{ fontWeight: 900, fontSize: 18, cursor: 'pointer' }}>獎勵（可展開）</summary>
              <div className="hr" />
              <div className="row">
                <div className="card" style={{ boxShadow: 'none', padding: 12 }}>
                  <div className="subtle">總完成次數</div>
                  <div style={{ fontSize: 28, fontWeight: 950 }}>{countTotalSessions(state)}</div>
                </div>
                <div className="card" style={{ boxShadow: 'none', padding: 12 }}>
                  <div className="subtle">總分鐘</div>
                  <div style={{ fontSize: 28, fontWeight: 950 }}>{countTotalMinutes(state)}</div>
                </div>
              </div>
              <div className="hr" />
              <div className="badgeGrid">
                {BADGES.map((b) => {
                  const unlocked = unlockedBadgeIds.has(b.id)
                  return (
                    <div key={b.id} className={`badge ${unlocked ? '' : 'badgeLocked'}`}>
                      <div style={{ fontWeight: 900 }}>{b.title}</div>
                      <div className="tiny" style={{ marginTop: 4 }}>
                        {b.desc}
                      </div>
                      <div className="tiny" style={{ marginTop: 8 }}>
                        狀態：{unlocked ? '已解鎖' : '未解鎖'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </details>

            {/* 設定（預設收合） */}
            <details
              className="card"
              open={settingsOpen}
              onToggle={(e) => {
                const isOpening = (e.currentTarget as HTMLDetailsElement).open
                if (isOpening && !adminUnlocked) {
                  setSettingsOpen(false)
                  requestAdminUnlock()
                  return
                }
                setSettingsOpen(isOpening)
              }}
            >
              <summary style={{ fontWeight: 900, fontSize: 18, cursor: 'pointer' }}>
                設定（管理員）
                {!adminUnlocked ? <span className="tiny"> · 需要密碼</span> : null}
              </summary>
              <div className="tiny" style={{ marginTop: 8 }}>
                注意：純網頁版無法在背景自動執行；週日同步會在你「開啟 App 時」自動嘗試一次，也可按下「立即同步」。
              </div>
              <div className="hr" />

              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div className="tiny">病人編號</div>
                  <input
                    className="input"
                    value={state.patientId || ''}
                    onChange={(e) => setPatientId(e.target.value)}
                    placeholder="例如：P0001"
                  />
                </div>

                <div>
                  <div className="tiny">Google Apps Script Web App URL</div>
                  <input
                    className="input"
                    value={state.settings.appsScriptUrl || ''}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        settings: { ...prev.settings, appsScriptUrl: e.target.value },
                      }))
                    }
                    placeholder="https://script.google.com/macros/s/....../exec"
                  />
                </div>

                <div>
                  <div className="tiny">（可選）簡單密鑰 Secret</div>
                  <input
                    className="input"
                    value={state.settings.appsScriptSecret || ''}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        settings: { ...prev.settings, appsScriptSecret: e.target.value },
                      }))
                    }
                    placeholder="留空亦可"
                  />
                </div>

                <div className="row">
                  <button className="btn btnPrimary" onClick={manualSync}>
                    立即同步（本週）
                  </button>
                  <button className="btn" onClick={exportCsv}>
                    匯出 CSV
                  </button>
                </div>

                <button className="btn" onClick={resetTodayAll}>
                  重設今日（清除 3 次記錄）
                </button>

                <div className="tiny">上次同步週末：{state.settings.lastSyncedWeekEnd || '尚未同步'}</div>
              </div>
            </details>
          </>
        )}
      </div>
    </>
  )
}

function SetupCard({ onSave }: { onSave: (id: string) => void }) {
  const [id, setId] = useState('')
  return (
    <div className="card">
      <div style={{ fontWeight: 900, fontSize: 16 }}>首次設定</div>
      <div className="subtle" style={{ marginTop: 6 }}>
        請輸入醫護人員提供的「病人編號」。此編號只需在第一次設定，之後會保存在本機。
      </div>
      <div style={{ marginTop: 12 }}>
        <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="例如：P0001" />
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn btnPrimary" onClick={() => onSave(id)} disabled={!id.trim()}>
          開始使用
        </button>
      </div>
    </div>
  )
}

function SessionRow({
  title,
  sessionId,
  record,
  onStart,
  onStop,
  runningInfo,
}: {
  title: string
  sessionId: SessionId
  record: { sessions: { id: SessionId; done: boolean; minutes: number; startedAt?: string }[] }
  onStart: (id: SessionId) => void
  onStop: (id: SessionId) => void
  runningInfo: null | { sessionId: SessionId; startMs: number; total: number; elapsed: number; remaining: number }
}) {
  const s = record.sessions.find((x) => x.id === sessionId)!
  const isRunning = runningInfo?.sessionId === sessionId && !!s.startedAt && !s.done
  const totalSeconds = (s.minutes || 5) * 60
  const remaining = isRunning ? Math.max(0, runningInfo!.remaining) : totalSeconds
  const statusText = s.done ? '已完成' : isRunning ? '進行中' : '未開始'

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: 20 }}>{title}</div>
          <div className="tiny" style={{ marginTop: 2 }}>
            狀態：{statusText}
            {isRunning && s.startedAt ? ` · ${format(parseISO(s.startedAt), 'HH:mm')} 開始` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {s.done ? null : isRunning ? (
            <button className="btn btnPrimary" onClick={() => onStop(sessionId)} style={{ padding: '14px 16px' }}>
              停止
            </button>
          ) : (
            <button className="btn btnPrimary" onClick={() => onStart(sessionId)} style={{ padding: '14px 16px' }}>
              開始
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 1000,
            letterSpacing: 2,
            textAlign: 'center',
            padding: '18px 0 10px',
          }}
        >
          {fmtMMSS(remaining)}
        </div>
        <div className="tiny" style={{ textAlign: 'center' }}>
          目標 {fmtMMSS(totalSeconds)}
        </div>
      </div>
    </div>
  )
}

export default App
