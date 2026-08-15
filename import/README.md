# 瀏覽器端題庫轉檔工具 — 架構規劃

對應 GitHub issue #5（[joy3352763/take_the_test](https://github.com/joy3352763/take_the_test/issues/5)）方案三的資料前處理需求。整個轉檔工具是純前端頁面，不需要後端伺服器，可以直接放進現有的靜態網站專案裡。

## 建議的檔案結構

```
take_the_test/
├── index.html              # 現有的刷題主頁面
├── script.js                # 現有的刷題邏輯
├── style.css
│
└── import/                  # 新增：題庫匯入工具（獨立子目錄）
    ├── import.html           # 匯入工具的獨立頁面
    ├── main.js               # orchestrator：偵測檔案類型、呼叫對應parser、跑validation、輸出JSON
    ├── parsers.js            # 各格式的parser：PDF / DOCX / Excel / CSV / TXT / RTF
    ├── core.js               # schema驗證 + 圖片大小分流(Base64 vs 檔案) + JSON/ZIP匯出
    │
    └── vendor/               # 第三方函式庫（用CDN或本地下載皮可）
        ├── pdf.js            # PDF文字/樣式抽取
        ├── mammoth.browser.js # DOCX轉HTML，含image inline base64
        ├── exceljs.min.js    # Excel讀取，含cell anchor圖片對應
        └── jszip.min.js      # 大圖片打包成zip資產包（可選）
```

## Pipeline 對應關係

| 階段 | 對應檔案 | 說明 |
|---|---|---|
| 1. 上傳/偵測格式 | `main.js` | 依副檔名分派給對應parser |
| 2. 格式解析 | `parsers.js` | 統一輸出中介格式（見下） |
| 3. 浮水印過濾（PDF限定） | `parsers.js`（PDF parser內） | 依文字span顏色/透明度過濾 |
| 4. Schema驗證 | `core.js` | 選項數1-10、單選/多選規則檢查 |
| 5. 圖片分流 | `core.js` | <15KB→Base64存欄位，≥15KB→存進zip資產包+路徑 |
| 6. 輸出 | `main.js` | 下載JSON（+可選zip） |

## 中介格式（所有parser統一輸出這個結構）

```js
{
  id: "q5",
  question: "...",
  question_image: null,          // Base64 data URI 或 "assets/xxx.png"
  type: "single" | "multiple",
  options: ["...", "..."],
  option_images: [null, null],
  answers: [0],                  // index陣列
  source: { file: "xxx.pdf", page: 3 }, // 除錯用
  needs_review: false            // 驗證失敗或圖片對應不確定時標記為true
}
```

## 已知限制（沿用之前討論的結論）

- RTF沒有主流瀏覽器函式庫，`parsers.js`裡的RTF parser是簡化版regex解析，只處理常見的`\pict`與段落結構，複雜排版可能需要人工覆核。
- PDF浮水印過濾邏輯需要依實際PDF樣本的顏色/透明度調整判斷條件，`parsers.js`裡先留一個可設定的filter function。
- Excel若圖片是用「插入到儲存格內」(in-cell image)而非傳統浮動繪圖層插入，`ExcelJS`可能讀不到，需另外解析zip內的`xl/media`。
