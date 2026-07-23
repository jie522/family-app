# 知識庫管理指令(Karpathy Style LLM Wiki)

本文件定義 Claude Code 在這個 repo 裡協助維護個人知識庫的最高運作準則,模仿 Andrej Karpathy 的個人 Wiki 系統,建立一個 AI 與人類協作的知識網絡。

> ⚠️ **這個 repo 是 Public**(因為要用免費的 GitHub Pages 給家人手機瀏覽,見 [README.md](README.md))。
> `Raw/`、`Wiki/`、`Log/` 以及根目錄的 `concepts.txt`/`entities.txt`/`sources.txt`/`processing.log`
> 已加進 `.gitignore`,**預設不會被推上 GitHub**,只存在這台電腦和 Obsidian 裡。
> 想公開特定筆記,要手動 `git add -f <檔案>`。**除非使用者明確要求「公開這篇」或「加進 git」,
> 否則不要主動把知識庫內容加入 git 追蹤或推上 GitHub。**

## 0. 這個 repo 的雙系統關係

這個 repo 同時是「FAMIAP」App(追劇清單 + 台股追蹤)的原始碼,也是這份個人知識庫。兩者關係:

- **`reports/<代號>/YYYY-MM-DD.md`**:App 顯示用的**精簡公開版**股票分析,固定格式(股價表現/營運消息/風險/來源),受眾是全家人,會推上 GitHub、同時鏡像一份到 Google Sheet 分頁「FAMAILY APP - 股票」。
- **`Wiki/` + `Log/`**:背後的**個人研究筆記**,可以更長、更雜、更主觀,不受 App 顯示格式限制,預設不公開。

### App 前端規範

- **字體**:全站文字統一用 **Noto Sans TC(思源黑體)**,透過 Google Fonts 載入(見 [index.html](index.html) 的 `<link>`),`css/style.css` 的 `body { font-family }` 以它為第一順位,後面接系統字體當備援。之後新增頁面或元件不要另外指定字體。
- **快取破壞(cache-busting)**:`index.html` 引用 `css/style.css`、`js/*.js` 都帶了 `?v=YYYYMMDD` 版本參數。**每次 push 有改到 CSS 或 JS 檔案時,一併把 `index.html` 裡所有 `?v=` 參數更新成當天日期**,否則家人手機瀏覽器可能因為快取舊檔案,看不到最新樣式或功能(遇過的實際問題:改了股票標籤樣式、加了新股票的標籤對照,push 後手機端沒更新)。

### 每檔股票的固定配備(新增股票時必備,四樣缺一不可)

App 的股票詳情頁用「公司簡介/產業知識/分析報告」**三個頁籤**呈現,所以**第一次幫某檔股票建報告時,以下四樣都要一起建好**,不可以只做一部分:

- `reports/<代號>/_about.md` — **公司簡介**:公司在做什麼生意、核心技術/競爭力(穩定不太變,之後有重大變化再更新同一個檔案)
- `reports/<代號>/_industry.md` — **產業知識**:所屬產業的背景入門(為什麼是題材、產業鏈分工、要盯的指標)
- `reports/<代號>/YYYY-MM-DD.md` — **分析報告**:當次近況分析,每次新增日期檔不覆蓋舊的,並把日期加進 `reports/manifest.json`(最新日期放最前面)
- **股票列表小標籤**:在 `js/stocks.js` 的 `PRODUCT_TAGS` 物件加入該代號對應的主要產品標籤(例如 `'2059': '滑軌'`),讓列表上一眼看出這檔在做什麼;缺這一步,該股票在列表就不會顯示標籤

四樣缺一個都算沒做完,不要漏掉小標籤這一步。之後的例行更新以「新增日期報告 + 更新 manifest」為主;`_about.md` / `_industry.md` / `PRODUCT_TAGS` 只在內容過時、有新資訊、或主力產品改變時才需要更新。

兩者可以互相參照(例如 `Log/` 裡的深度分析,提煉出重點後寫成 `reports/` 的精簡版),但不是同一份東西,不要把兩者的內容互相覆蓋。

### 公開知識庫(App 裡的「知識庫」頁籤)

`knowledge/` 資料夾是**公開版**的產業知識與投資框架,會推上 GitHub、顯示在 App 底部導覽「📚 知識庫」頁籤裡,是獨立的全域頁面(不綁定單一股票)。跟 `Wiki/Concepts/` 的差異:

- `Wiki/Concepts/<概念>.md` — 私人版,可以有比較細的個人判斷、日期戳記的推論過程,不公開
- `knowledge/<slug>.md` — 公開版,拿掉 Obsidian 的 `[[雙向連結]]`語法和 YAML frontmatter,改寫成全家都看得懂的口吻;`knowledge/manifest.json` 是索引(`[{slug,title,summary}, ...]`)

**站內連結語法**(`js/store.js` 的 `mdToHtml()` 支援):
- `[顯示文字](k:另一個slug)` → 跳到知識庫另一篇文章
- `[顯示文字](s:股票代號)` → 跳去該股票的詳情頁(股票不在追蹤清單裡會提示去搜尋加入)

當一個 Concept 頁「值得讓全家看到、且內容本身沒有個人敏感判斷」時,才把它也寫一份公開版到 `knowledge/`(不是每個 Wiki Concept 都要公開)。新增 `knowledge/*.md` 記得同步更新 `knowledge/manifest.json`。

### 報告 → 知識庫的自動 Ingest(股票報告工作流)

每次新增或大幅更新 `reports/` 的股票報告後,**自動執行一次 Ingest** 把知識提煉進 Wiki(不用再問使用者):

1. **Entity**:該公司若無 `Wiki/Entities/Organizations_<公司名>.md` 就建立;已有就合併更新(投資視角重點、供應鏈關係)
2. **Concept**:報告中的產業邏輯(如商業模式、題材框架)若值得沉澱,建立或補充 Concept 頁
3. **Source**:更新 `Wiki/Sources/Reports_<代號>_<公司名>.md`,登記報告檔案與其貢獻的知識點
4. **Index & Log**:更新 `Index.md`、對應的追蹤清單(concepts/entities/sources.txt)、`Log/` 日誌與 `processing.log`

Wiki 頁面寫「投資視角的提煉」(定位、劇本、風險、觀察指標、與其他持股的關聯),不要複製報告全文。公司之間的供應鏈關係用 `[[雙向連結]]` 串起來(例如 [[AI供應鏈]] 串 2330→2317)。

## 1. 系統目標與結構

建立一個 AI 與人類協作的知識網絡,核心三層結構(The Three Layers):

- 📁 **Raw Source(原始資料層)**:存放於 `/Raw/`。收集原始素材(Markdown、PDF、網頁剪取)。
- 📝 **The Wiki(精華知識層)**:存放於 `/Wiki/`。AI 提煉後的結構化知識,透過雙向連結(`[[連結]]`)互聯。
- ⚙️ **The Schema(協作規範層)**:即本 `CLAUDE.md` 文件。定義 AI 與人類的協作規則。

## 2. 目錄與檔案結構規範

- `/Raw/`:存放原始素材。
- `/Wiki/Concepts/`:核心概念、理論、技術定義。
- `/Wiki/Entities/`:實體頁面(人物、組織、軟體、工具)。採扁平化管理,禁止使用子資料夾。
- `/Wiki/Sources/`:原始文章的摘要與其貢獻的知識點對照。
- `/Index.md`(位於 `Wiki/` 或知識庫根目錄):全域索引,列出所有頁面與分類。
- `/Log/`:處理日誌,紀錄已處理的檔案與日期。檔名規範如下:
  - `YYYY-MM-DD_Activity.md` — 當日多任務綜合操作日誌
  - `YYYY-MM-DD_[股票代號]_分析紀錄.md` — 單一股票深度分析
  - `YYYY-MM-DD_綜合股票分析紀錄.md` — 跨股票整合報告
  - `processing.log` — 系統純文字操作記錄(非 Markdown)
- `concepts.txt`、`entities.txt`、`sources.txt`:根目錄下的追蹤清單,用於快速核對各類別檔案狀態。

## 3. 三大核心動作(The Three Actions)

### 🔄 Ingest(吸收與同步)

1. **掃描**:用 Glob/Grep 對比 `Raw/` 與 `Log/`,找出尚未紀錄的新檔案。
2. **分析**:提取核心概念(Concepts)與實體(Entities)。
3. **寫入 Source**:在 `/Wiki/Sources/` 建立摘要頁面。
4. **更新 Wiki**:建立或合併頁面。若頁面已存在,用 Edit **合併**新內容,不可覆蓋舊內容。Entity 必須遵循命名規範。
5. **更新 Index & Log**:將新頁面加入 `Index.md` 並記錄處理日誌。

### 💬 Query(提問與回寫)

1. **檢索**:優先閱讀 `Index.md` 與相關 Wiki 頁面以獲得情境。
2. **回答**:基於現有知識庫回答問題。
3. **回寫(Back-write)**:(自動執行)在完成高品質的分析或回答後,主動將內容整理為新的 Wiki 頁面,無須再次詢問用戶。

### 🔍 Lint(體檢與優化)

1. **檢測**:定期檢查知識庫,尋找矛盾內容、孤立頁面或過時技術。
2. **校對**:確保所有頁面符合格式規範與命名準則。
3. **連結修復**:檢查並修復失效的 `[[雙向連結]]`。

## 4. Wiki 頁面格式要求

- **YAML Frontmatter**:必須包含 `created`、`updated`、`tags`、`type`(concept/entity/source)。
- **標題**:使用一級標題 `#`。
- **Entity 命名規範**:為取代資料夾分類,Entity 檔案必須加上類別前綴:
  - `People_名稱.md`(人物)
  - `Organizations_名稱.md`(組織)
  - `Software_名稱.md`(軟體)
  - `Tools_名稱.md`(工具)
- **雙向連結**:積極使用 `[[連結]]`,確保檔案名稱與連結完全一致。
- **來源溯源**:Concept/Entity 頁面下方必須標註 `## 來源` 並連結至 `/Wiki/Sources/` 內的對應頁面。

## 5. 交互原則與部署

- **優先檢索**:優先使用 Grep 工具確認內容是否已存在,避免重複建立頁面。
- **自主回寫**:根據指令,分析後應直接執行 Ingest 動作更新 Wiki,僅在大規模架構變動或具高度歧義時才詢問。
- **透明度**:在執行更新時,簡述已完成或正在進行的操作。
- **主動性**:在 Ingest 過程中主動建立強關聯連結,發現矛盾時主動提醒。
- **隱私邊界**:知識庫內容預設只存在本機(見開頭的 `.gitignore` 說明),不主動推上 GitHub。

### 初始化與部署(Initialization & Deployment)

當收到「部署」或「初始化」指令時,應自主執行:

1. **建立目錄結構**:建立 `Raw`、`Wiki/Concepts`、`Wiki/Entities`、`Wiki/Sources`、`Log` 等資料夾。
2. **初始化索引**:建立 `Index.md` 並寫入基礎分類架構。
3. **確認完成**:回報進度並準備接收資料。

---
最後更新日期時間:2026-07-15
