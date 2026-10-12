# PM Studio

沿用既有 PM Studio 儲存庫，保留最新程式，從乾淨的單一根提交重新開始。Google Apps Script 提供內部與公開兩個獨立的工作區卡片排程網站；此版本只保存程式、規則、虛構測試與部署說明。

AI 工作規則見 [AGENTS.md](AGENTS.md)，部署說明見 [Google 網頁](google-app/README.md)。最新專案現況只維護在 Google 試算表的「專案列表」；工作區安排存於獨立設定表，公開網站只讀經核准的匿名資料。

實際來源 ID 只填在 Apps Script 指令碼屬性。既有私有操作入口可保留於 Git 忽略的 `local/operations/`；使用前讀取其中最新設定，再讀最新雲端資料。原始附件與全文 TXT 保存於 Drive；`transcripts/<案號>/` 只保存實際來源的本機私有解析文字，由 `.gitignore` 忽略，不上傳乾淨程式庫。私有操作資料與舊版備份留在本機，不納入乾淨程式歷史。

## 本機檢查

使用 Node.js 24。

```sh
node --test google-app/tests/*.test.mjs web/tests/timeline-core.test.mjs
node scripts/serve-google-preview.mjs
```

預覽入口為 [內部示意](http://127.0.0.1:4318/internal)與 [公開示意](http://127.0.0.1:4318/public)，僅使用虛構案件，不能視為真實檔期。

## 建立部署包

```sh
node scripts/build-google-ui.mjs
```

兩份獨立 Apps Script 部署包產生於 `local/google-app-bundle/`。內部版按存取者的 Google 共用權限讀取資料；公開版僅顯示人工核准的匿名排程，空白時間仍須由團隊確認。
