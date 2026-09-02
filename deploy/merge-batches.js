#!/usr/bin/env node
/**
 * deploy/merge-batches.js
 *
 * 依 issue #23 / #24 定案：review.js 只依核准批次各自匯出 batch_NNN.zip
 * （每個 zip 內含 batch_NNN.csv + assets/*.bmp|png|jpg...）。
 * 正式刷題程式（index.html/script.js）需要的是「單一 assets/ 目錄 + 單一正式 CSV」，
 * 這個建置步驟負責把多個 batch_*.zip 收斂成那份最終產物。
 *
 * 用法：
 *   npm install jszip   (只有這個外部依賴)
 *   node deploy/merge-batches.js <batches目錄> <輸出目錄>
 *
 * 例如：
 *   node deploy/merge-batches.js ./downloads ./dist
 *
 * 產出：
 *   <輸出目錄>/questions.csv   — 所有批次題目合併後的正式 CSV（題號不重複、跨批次連續）
 *   <輸出目錄>/assets/*        — 所有批次的圖片檔案（檔名全域唯一，安全合併，見 review.js 註解）
 *
 * 之後把 <輸出目錄> 的內容連同 index.html/script.js/style.css 一起部署，
 * img_stem/img_optA~D/img_explain 欄位裡的相對路徑（例如 assets/xxx.bmp）就能正確解析。
 */

const fs = require("fs");
const path = require("path");

let JSZip;
try {
  JSZip = require("jszip");
} catch (e) {
  console.error(
    "缺少 jszip 依賴，請先在專案根目錄執行: npm install jszip"
  );
  process.exit(1);
}

function parseArgs() {
  const [, , inputDir, outputDir] = process.argv;
  if (!inputDir || !outputDir) {
    console.error(
      "用法: node deploy/merge-batches.js <batches目錄> <輸出目錄>"
    );
    process.exit(1);
  }
  return { inputDir, outputDir };
}

function stripBOM(str) {
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function escapeCell(val) {
  const s = val === undefined || val === null ? "" : String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCSV(headers, rows) {
  const lines = [headers.map(escapeCell).join(",")];
  rows.forEach((r) => lines.push(headers.map((h) => escapeCell(r[h] ?? "")).join(",")));
  return "\uFEFF" + lines.join("\r\n");
}

function listBatchZips(inputDir) {
  const files = fs.readdirSync(inputDir).filter((f) => /^batch_\d+\.zip$/i.test(f));
  files.sort((a, b) => {
    const na = parseInt(a.match(/\d+/)[0], 10);
    const nb = parseInt(b.match(/\d+/)[0], 10);
    return na - nb;
  });
  return files;
}

async function main() {
  const { inputDir, outputDir } = parseArgs();

  if (!fs.existsSync(inputDir)) {
    console.error(`找不到輸入目錄: ${inputDir}`);
    process.exit(1);
  }

  const batchFiles = listBatchZips(inputDir);
  if (batchFiles.length === 0) {
    console.error(`在 ${inputDir} 底下找不到任何 batch_NNN.zip`);
    process.exit(1);
  }

  const assetsOutDir = path.join(outputDir, "assets");
  fs.mkdirSync(assetsOutDir, { recursive: true });

  let headers = null;
  const allRows = [];
  const seenAssetPaths = new Set();
  const questionNumbers = new Set();
  let duplicateNumberCount = 0;
  let missingImageCount = 0;

  for (const batchFile of batchFiles) {
    const zipPath = path.join(inputDir, batchFile);
    console.log(`讀取 ${batchFile} ...`);
    const buf = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(buf);

    const csvEntryName = Object.keys(zip.files).find((name) =>
      /^batch_\d+\.csv$/i.test(name)
    );
    if (!csvEntryName) {
      console.warn(`  警告: ${batchFile} 裡沒找到 batch_NNN.csv，略過此批。`);
      continue;
    }

    const csvText = stripBOM(await zip.file(csvEntryName).async("string"));
    const table = parseCSV(csvText);
    if (table.length === 0) {
      console.warn(`  警告: ${batchFile} 的 CSV 是空的，略過此批。`);
      continue;
    }
    const [fileHeaders, ...dataRows] = table;

    if (!headers) {
      headers = fileHeaders;
    } else {
      const missing = headers.filter((h) => !fileHeaders.includes(h));
      const extra = fileHeaders.filter((h) => !headers.includes(h));
      if (missing.length || extra.length) {
        console.warn(
          `  警告: ${batchFile} 的欄位與前面批次不一致 (缺少: ${missing.join(
            "、"
          ) || "無"}；多出: ${extra.join("、") || "無"})，仍會嘗試合併。`
        );
        extra.forEach((h) => headers.push(h));
      }
    }

    const imgFields = fileHeaders.filter((h) => h.startsWith("img_"));

    for (const dataRow of dataRows) {
      const row = {};
      fileHeaders.forEach((h, idx) => (row[h] = dataRow[idx] ?? ""));

      const qNum = row["題號"];
      if (qNum) {
        if (questionNumbers.has(qNum)) {
          duplicateNumberCount++;
          console.warn(`  警告: 題號 ${qNum} 在多個批次中重複出現。`);
        }
        questionNumbers.add(qNum);
      }

      for (const field of imgFields) {
        const imgPath = row[field];
        if (!imgPath) continue;
        if (seenAssetPaths.has(imgPath)) continue;

        const entry = zip.file(imgPath);
        if (!entry) {
          missingImageCount++;
          console.warn(
            `  警告: 題號 ${qNum || "?"} 的 ${field}="${imgPath}" 在 ${batchFile} 裡找不到對應圖檔。`
          );
          continue;
        }
        const destPath = path.join(outputDir, imgPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const content = await entry.async("nodebuffer");
        fs.writeFileSync(destPath, content);
        seenAssetPaths.add(imgPath);
      }

      allRows.push(row);
    }
  }

  if (!headers) {
    console.error("沒有任何批次成功解析，未產出檔案。");
    process.exit(1);
  }

  const outCsvPath = path.join(outputDir, "questions.csv");
  fs.writeFileSync(outCsvPath, rowsToCSV(headers, allRows), "utf8");

  console.log("");
  console.log(`合併完成：共 ${batchFiles.length} 個批次，${allRows.length} 題。`);
  console.log(`已寫入圖片 ${seenAssetPaths.size} 個到 ${assetsOutDir}`);
  console.log(`已寫入合併 CSV: ${outCsvPath}`);
  if (duplicateNumberCount > 0) {
    console.log(`注意：發現 ${duplicateNumberCount} 個重複題號，請檢查來源批次是否重疊匯出。`);
  }
  if (missingImageCount > 0) {
    console.log(`注意：發現 ${missingImageCount} 個題目的圖片欄位找不到對應圖檔，請檢查匯出來源。`);
  }
}

main().catch((err) => {
  console.error("合併失敗:", err);
  process.exit(1);
});
