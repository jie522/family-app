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

追劇清單和股票追蹤清單存在**各自手機的瀏覽器**裡(localStorage)。
想把資料搬到另一支手機:設定頁 → 匯出資料 → 傳給家人 → 對方匯入。

## 本機測試

```
node scripts/fetch_stocks.mjs        # 更新股票資料
python -m http.server 8080           # 或任何靜態伺服器
```

然後開 http://localhost:8080
