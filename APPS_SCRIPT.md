# Google Sheets 同步（Apps Script Webhook）

此原型採用「Google Apps Script Web App」作為 webhook。病人手機端只需要保存一個 URL（以及可選的 secret），不需要保存任何 Google 帳戶或 API 憑證。

## 1) 建立 Google Sheet

1. 建立一份 Google Sheet，例如命名：`PLB Pilot`
2. 新增工作表（Sheet）命名：`records`
3. 在 `records` 第一列加入標題（建議）：
   - `patientId`
   - `weekStart`
   - `weekEnd`
   - `date`
   - `sessionsCompleted`
   - `minutesTotal`
   - `sentAt`

## 2) 建立 Apps Script（Web App）

1. 在 Google Sheet 內：**擴充功能 → Apps Script**
2. 貼上以下程式碼（可自行修改 `SHEET_NAME` / `REQUIRED_SECRET`）。

> ✅ 已包含「去重 / 覆蓋」邏輯：同一位病人同一天（`patientId + date`）若已存在資料列，會直接更新該列，避免每次同步都重複新增。

```javascript
const SHEET_NAME = 'records'
// 可選：留空 '' 代表不檢查密鑰；建議 pilot 先用簡單字串
const REQUIRED_SECRET = '' // 例如 'myPilotSecret'

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}')

    if (REQUIRED_SECRET && body.secret !== REQUIRED_SECRET) {
      return ContentService.createTextOutput('unauthorized').setMimeType(ContentService.MimeType.TEXT)
    }

    if (body.type !== 'pursed_lip_breathing_weekly_sync') {
      return ContentService.createTextOutput('invalid type').setMimeType(ContentService.MimeType.TEXT)
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME)

    // 第一次自動建立表頭（如未建立）
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['patientId','weekStart','weekEnd','date','sessionsCompleted','minutesTotal','sentAt'])
    }

    const patientId = body.patientId || ''
    const weekStart = body.weekStart || ''
    const weekEnd = body.weekEnd || ''
    const sentAt = body.sentAt || new Date().toISOString()
    const daily = Array.isArray(body.daily) ? body.daily : []

    // ===== 去重 / 覆蓋（Upsert）=====
    // key = patientId|date
    const values = sheet.getDataRange().getValues()
    const index = {}
    for (let r = 1; r < values.length; r++) { // r=1 表示第 2 列（跳過表頭）
      const row = values[r]
      const pid = String(row[0] || '')
      const date = String(row[3] || '')
      if (pid && date) index[pid + '|' + date] = r + 1 // 轉成 1-based row number
    }

    // 每天一行：方便做樞紐分析 / 圖表
    daily.forEach((d) => {
      const date = d.date || ''
      const row = [
        patientId,
        weekStart,
        weekEnd,
        date,
        Number(d.sessions || 0),
        Number(d.minutes || 0),
        sentAt,
      ]

      const key = patientId + '|' + date
      const existingRow = index[key]
      if (existingRow) {
        sheet.getRange(existingRow, 1, 1, row.length).setValues([row])
      } else {
        sheet.appendRow(row)
      }
    })

    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT)
  } catch (err) {
    return ContentService.createTextOutput(String(err)).setMimeType(ContentService.MimeType.TEXT)
  }
}
```

## 3) 部署 Web App

1. Apps Script 右上角：**部署 → 新增部署**
2. 類型選 **Web app**
3. 執行身分：**我**
4. 誰可以存取：pilot 建議 **任何人（含匿名）**，並配合 `REQUIRED_SECRET` 做最基本保護  
5. 取得部署 URL（以 `/exec` 結尾）

## 4) 在病人 App 內設定

在「設定」頁貼上：
- Apps Script Web App URL
- （可選）Secret（需與 `REQUIRED_SECRET` 相同）

## 使用量 / quota（50 位病人 pilot）

50 位病人每週同步一次 ≈ **50 次請求/週**，通常遠低於 Apps Script 與 Sheets 的免費 quota。實際 quota 取決於你的 Google 帳戶類型（個人/Workspace），但以此規模一般不會成為限制。
