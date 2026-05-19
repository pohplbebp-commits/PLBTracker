import { format, isSunday, subDays } from 'date-fns'
import type { AppState } from './storage'
import { getDailyCountsBetween, getWeekRangeContaining } from './stats'

export type SyncResult =
  | { ok: true; message: string }
  | { ok: false; message: string; status?: number }

function ymd(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

export function getWeekEndForAutoSync(now = new Date()) {
  const { weekEnd } = getWeekRangeContaining(now)
  // If it's not Sunday yet, auto-sync should target the previous Sunday (last completed week).
  return isSunday(now) ? weekEnd : subDays(weekEnd, 7)
}

export function getWeekEndForManualSync(now = new Date()) {
  // Manual sync should reflect the current week (so patients can verify immediately).
  const { weekEnd } = getWeekRangeContaining(now)
  return weekEnd
}

export async function syncWeekToAppsScript(state: AppState, weekEnd: Date): Promise<SyncResult> {
  const url = state.settings.appsScriptUrl?.trim()
  if (!url) return { ok: false, message: '未設定 Apps Script Web App URL。' }
  if (!state.patientId) return { ok: false, message: '未設定病人編號。' }

  const { weekStart, weekEnd: we } = getWeekRangeContaining(weekEnd)
  const daily = getDailyCountsBetween(state, weekStart, we)

  const payload = {
    type: 'pursed_lip_breathing_weekly_sync',
    patientId: state.patientId,
    weekStart: ymd(weekStart),
    weekEnd: ymd(we),
    daily,
    sentAt: new Date().toISOString(),
    secret: state.settings.appsScriptSecret || undefined,
  }

  try {
    /**
     * NOTE (重要限制)：
     * Google Apps Script Web App 通常無法被瀏覽器跨網域 fetch 直接讀取回應（CORS 限制），
     * 常見現象是前端看到：TypeError: Failed to fetch。
     *
     * 這裡採用 mode: 'no-cors' 變成「只送出、不讀回應」的方式（fire-and-forget），
     * 以符合「純前端 + Apps Script」的最低成本同步。
     *
     * 若你需要可回傳成功/失敗狀態（可讀取 HTTP code / body），需要加一層中介 API（proxy）
     * 或改用後端服務來處理 Google Sheets 寫入與 CORS header。
     */
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      mode: 'no-cors',
    })
    return { ok: true, message: '已送出同步（由於瀏覽器限制，無法即時讀取回應）。' }
  } catch (e) {
    return { ok: false, message: `同步失敗：${String(e)}` }
  }
}
