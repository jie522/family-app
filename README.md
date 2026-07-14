# 🏠 家庭小站

家庭共用的小工具網站,手機瀏覽器開網址就能用:

- 📺 **追劇清單** — 記錄想看 / 追劇中 / 看完的劇,自動抓海報,寫下什麼時候看了什麼
- 📈 **台股追蹤** — 追蹤股票的收盤價、漲跌、本益比、殖利率,寫分析筆記

純靜態網頁,不需要伺服器,放在 GitHub Pages 上完全免費。

## 部署到 GitHub(一次性設定)

1. 到 [github.com](https://github.com) 登入,建立新 repository(例如叫 `family-app`)
2. 把這個資料夾的所有檔案推上去:
   ```
   git init
   git add .
   git commit -m "家庭小站 v1"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/family-app.git
   git push -u origin main
   ```
3. 到 repo 的 **Settings → Pages**,Source 選 **Deploy from a branch**,Branch 選 `main` / `(root)`,存檔
4. 幾分鐘後網址就會生效:`https://<你的帳號>.github.io/family-app/`
5. 到 repo 的 **Settings → Actions → General**,Workflow permissions 選 **Read and write permissions**(讓自動更新股票資料的機器人可以寫入)

之後每個交易日台北時間 18:00,GitHub 會自動抓最新收盤資料。也可以到 **Actions → 更新台股資料 → Run workflow** 手動更新。

## TMDB 海報設定(一次性)

1. 到 [themoviedb.org](https://www.themoviedb.org/signup) 註冊免費帳號
2. 帳號設定 → **API** → 申請 **API Key (v3 auth)**(用途填個人使用即可)
3. 在 App 的「設定」頁貼上金鑰

## 資料存哪裡?

- **追劇清單**:啟用「Google Sheet 同步」後,全家共用同一份 [追劇 Google Sheet](https://docs.google.com/spreadsheets/d/1rS_foFkuoFXVdK_9QxEFUFO7cPwwbX4Y8d7HY7yvIhI/edit)。
  App 的新增、觀看紀錄、評分都會自動寫進 Sheet;直接在 Sheet 第一個分頁加一列(日期/劇名/平台/備註)App 也讀得到。
- **股票追蹤清單**:存在各自手機的瀏覽器裡(之後想共用再說)。
- 沒啟用同步時,全部資料都只在手機裡,可用設定頁的匯出/匯入搬資料。

## Google Sheet 同步設定(一次性,約 5 分鐘)

讀取不用設定(Sheet 已開放連結檢視);要讓 App 能「寫入」,照 [apps-script/Code.gs](apps-script/Code.gs) 檔案開頭的 5 個步驟,
在 Sheet 的「擴充功能 → Apps Script」貼上程式並部署成網頁應用程式,把網址貼到 App 設定頁即可。
只需要 Sheet 的擁有者做一次;家人的手機貼同一個網址就能共用。

注意:Sheet 需維持「知道連結的使用者可以檢視」,App 才讀得到資料。

## 股票分析報告(搭配 Obsidian / Claude)

`reports/` 資料夾裡每檔股票一個 Markdown 檔(檔名 = 股票代號,如 `reports/8033.md`),
推上 GitHub 後,App 的股票詳情頁會自動顯示。格式參考 [reports/_template.md](reports/_template.md)。

建議工作流程:
1. 用 Obsidian 把這個 repo(或 `reports/` 資料夾)加為 vault,報告直接在 Obsidian 裡寫
2. 或請 Claude 查最新消息、直接產生/更新報告檔並推上 GitHub
3. 手機打開 App → 股票 → 點該檔股票,就能看到報告

## 本機測試

```
node scripts/fetch_stocks.mjs        # 更新股票資料
python -m http.server 8080           # 或任何靜態伺服器
```

然後開 http://localhost:8080
