# 瀏覽器端題庫轉檔工具 — 架構規劃

對應 GitHub issue #5（[joy3352763/take_the_test](https://github.com/joy3352763/take_the_test/issues/5)）方案三的資料前處理需求。整個轉檔工具是純前端頁面，不需要後端伺服器，可以直接放進現有的靜態網站專案裡。

## 建議的檔案結構

```
take_the_test/
├── index.html              # 現有的刷題主頁面
├── script.js                # 現有的刷題邏輯
├── style.css
│
└── import/                  # 新增：題庫匯入工具（独立子目錄）
    ├── import.html           # 匯入工具的独立頁面
    ├── main.js               # orchestrator：偵測檔案類型、呼叫對應parser、跑validation、輸出JSON
    ├── parsers.js            # 各格式的parser：PDF / DOCX / Excel / CSV / TXT / RTF
    ├── rtf-conventions.js    # RTF題庫的標記約定與 v2切塊/解析邏輯（包含\pict圖片抽取）
    ├── core.js               # schema驗證 + 圖片大小分流(Base64 vs 檔案) + JSON/ZIP匯出
    │
    └── vendor/               # 第三方函數庫（用CDN或本地下載皮可）
        ├── pdf.js            # PDF文字/樣式抽取
        ├── mammoth.browser.js # DOCX轉HTML，含image inline base64
        ├── exceljs.min.js    # Excel讀取，含cell anchor圖片對應
        └── jszip.min.js      # 大圖片打包成zip資產包（可選）
```

## Pipeline 對應關係

| 階段 | 對應檔案 | 說明 |
|---|---|---|
| 1. 上傳/偵測格式 | `main.js` | 依副檔名分派給對應parser |
| 2. 格式解析 | `parsers.js`（RTF則搭配`rtf-conventions.js`） | 統一輸出中介格式（見下） |
| 3. 浮水印過濾（PDF限定） | `parsers.js`（PDF parser内） | 依文字span題色/透明度過濾 |
| 4. Schema驗證 | `core.js` | 選項數1-10、單選/多選規則檢查 |
| 5. 圖片分流 | `core.js` | <15KB→Base64存欄位，≥15KB→存進zip資產包+路徑 |
| 6. 輸出 | `main.js` | 下載JSON（+可選zip） |

## 中介格式（所有parser統一輸出這個結構）

```js
{
  id: "q5",
  delimiter_label: "Q5",         // 原始分隔記號文字（人工審核列表展示用，避免與內部index混淆）
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

## RTF `\pict` 圖片抽取（新功能）

`rtf-conventions.js`現已支援偵測題庲/選項/詳解內嵌入的`\pict`圖片，抽取後轉成可顯示格式（包含DIB→BMP header修復），並導入zip資產包。匯出CSV新增欄位：`img_stem`、`img_optA`~`img_optD`、`img_explain`（同一欄位如有多張圖片以`;`分隔）。含圖片的題目不再被静點排除於匯出CSV之外，而是带著`待確認`旗標一同匯出，再人工複核。

向量格式（EMF/WMF）目前無法轉成可顯示格式，会被丢棄但題目仍會被標記為`needs_review`，不會寧静看似完整。rtf.js方案經实測確認会静點丢弃所有內嵌圖片且不會觸發任何fallback，因此目前已停用rtf.js抽取路徑，改用自制regex解析。

## 已知限制（沿用之前討論的結論）

- RTF沒有主流瀏覽器函數庫，`parsers.js`裡的RTF parser是簡化版regex解析，只處理常見的`\pict`與段落結構，複雑排版可能需要人工覆核。
- PDF浮水印過濾邏輯需要依實際 PDF樣本的題色/透明度調整判斷條件，`parsers.js`裡先留一個可設定的filter function。
- Excel若圖片是用「插入到儲存格內」(in-cell image)而非傳統浮動繪圖層插入，ExcelJS可能讀不到，需別外解析zip內的`xl/media`。
- 向量圖片（EMF/WMF）在RTF中目前不支援轉成可顯示格式，會被標記needs_review留待人工處理。
