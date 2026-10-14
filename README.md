# 星醫美學 EIP 全表單儀表板

React + Vite 靜態網站，透過 GitHub Actions 自動部署到 GitHub Pages。

## 部署
1. 將本資料夾所有檔案（含 `.github` 資料夾）推送到 repo 的 `main` 分支
2. Repo → Settings → Pages → Build and deployment → Source 選 **GitHub Actions**
3. 到 Actions 分頁等待 "Deploy to GitHub Pages" 完成，網址會顯示在該流程中

## 本機開發
```
npm install
npm run dev
```

## 備註
- AI 洞察功能已移除（前端無法安全保存 API Key），日後需改由後端代理呼叫。
- 資料在 GitHub Pages 上會透過第三方公共代理（allorigins.win、codetabs.com、corsproxy.io）讀取 Google 雲端檔案，請留意資料外流風險。
