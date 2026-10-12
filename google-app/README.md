# Google 排程網站

公開版顯示經核准的匿名排程；內部版顯示真實專案，沿用既有公司 Drive 共用權限。兩版使用獨立 Apps Script 專案；本機示意預覽不是真實檔期。

## 建立兩個專案

在 Apps Script 編輯器各建立一個新專案，依部署包新增對應檔案：

| 專案 | 部署包 | 專案內檔案 |
| --- | --- | --- |
| 內部版 | `local/google-app-bundle/internal/` | `Code.gs`、`Index.html`、`appsscript.json` |
| 公開版 | `local/google-app-bundle/public/` | `PublicCode.gs`、`PublicIndex.html`、`appsscript.json` |

兩版必須是獨立 Apps Script 專案，不混放程式。以編輯器新增指令碼與 HTML 檔，貼上部署包內容；在「專案設定」顯示 `appsscript.json`，套用該版 manifest。

## 填寫設定

在各專案的「專案設定 → 指令碼屬性」填入實際 ID；不把 ID 或帳號清單寫入公開程式。

| 屬性 | 內部版 | 公開版 |
| --- | --- | --- |
| `INTERNAL_FOLDER_ID` | 公司共用資料夾 ID，用來確認存取權限 | 不設定 |
| `INTERNAL_SHEET_ID` | 真實專案列表試算表 ID | 不設定 |
| `SETTINGS_SHEET_ID` | 工作區安排與發布設定試算表 ID | 不設定 |
| `PUBLIC_FEED_SHEET_ID` | 匿名公開資料試算表 ID | 同一份匿名資料 ID |
| `PUBLISHERS_JSON` | 管理員配置的授權發布者帳號 JSON 陣列 | 不設定 |

`PUBLISHERS_JSON` 未配置時禁止發布。內部使用者不另列員工白名單，實際資料讀取依 Google 既有共用權限；工作區安排的保存也需要設定檔的寫入權限。

資料檔使用固定頁籤：主表「專案列表」第 5 列為表頭；設定檔包含「工作區安排」與「公開設定」；匿名檔只含「匿名排程」。設定與匿名頁至少保留 1000 列，資料不超過此上限。部署時保留既有表頭，不將內部欄位複製到匿名檔。

## 部署與使用

1. 在編輯器選「部署 → 新增部署 → 網頁應用程式」。
2. 內部版選「以存取使用者執行」，存取選已登入使用者（`USER_ACCESSING`＋`ANYONE`）。每次讀取都由伺服器檢查公司資料夾與主表權限；無法取得登入身分或無存取權就拒絕。
3. 公開版選「以部署者執行」，存取選不必登入的所有人（`USER_DEPLOYING`＋`ANYONE_ANONYMOUS`）。內建試算表服務需要部署者授予 Google 試算表存取權；對外程式只實作讀取匿名資料，沒有寫入操作，網頁訪客不會取得 OAuth 憑證。若管理員政策未提供公開選項，先保留未公開狀態。
4. 依 Google 畫面完成授權，取得各自的部署網址。以可讀公司資料的帳號測試內部版，也確認未獲共用權限的帳號不能讀取內部資料。
5. 內部版按「重新讀取」讀取主表，點選卡片安排工作區與角色占用；日期與狀態仍在主表維護。週／月、左右導航、今日與過去日期展開只改瀏覽方式。
6. 匿名公開資料初始保持空白。首版沒有發布按鈕，管理員指定的發布者需手動準備核准資料，由內部程式的 `publishApprovedSnapshot({revision, approvals})` 發布。每筆包含已確認的 A／B／C／D 工作區安排、主表已確認的固定匿名名稱、核准目標與最新完整日期；A／B 另確認角色占用，各最多 2 位角色，C／D 未設定容量。`revision` 必須符合當次來源。公開目標不從真實目標自動生成。公開版只讀匿名資料，不讀真實主表。

公開畫面的空白時間不是自動成立的預約；需要聯繫團隊確認需求與檔期。部署成功及讀回測試完成前，不把原始檔上傳或本機預覽稱為已上線網站。

部署身分與存取設定見 [Google Web Apps 官方說明](https://developers.google.com/apps-script/guides/web)；依使用者權限讀取資料夾見 [Google DriveApp 官方說明](https://developers.google.com/apps-script/reference/drive/drive-app)。
