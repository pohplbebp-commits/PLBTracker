# 縮唇呼吸練習記錄（PLB Tracker）— Web 原型

特色（Traditional Chinese UI）：
- 每日 3 次練習記錄（每次 5–10 分鐘）
- 每日 / 每週 / 每月進度視覺化（週條形圖 + 月曆熱度格）
- 遊戲化：連續天數（Streak）+ 徽章（Badges）+ 每週挑戰（Challenges）
- 本機儲存（手機瀏覽器 LocalStorage）
- 匯出 CSV
- 週日同步到 Google Sheets（Apps Script webhook；病人端不需保存 Google 憑證）

## 開始使用（本機開發）

```bash
npm install
npm run dev
```

## Google Sheets 同步

請參考：[`APPS_SCRIPT.md`](./APPS_SCRIPT.md)

> 注意：純網頁版無法在背景自動執行；「週日同步」會在你開啟 App 時自動嘗試，或可在設定頁手動按「立即同步」。

