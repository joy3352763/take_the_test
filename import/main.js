// main.js — orchestrator：偵測檔案類型 -> 分派parser -> 驗證 -> 顯示結果 -> 匯出

let allQuestions = [];
let currentAssetBag = {};

document.getElementById("convertBtn").addEventListener("click", async () => {
  const files = document.getElementById("fileInput").files;
  if (!files.length) {
    alert("請先選擇檔案");
    return;
  }

  let collected = [];
  for (const file of files) {
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      const result = await parseByExtension(file, ext);
      collected = collected.concat(result);
    } catch (e) {
      console.error(`解析 ${file.name} 失敗:`, e);
    }
  }

  const { questions, assetBag, reviewList } = Core.processQuestions(collected);
  allQuestions = questions;
  currentAssetBag = assetBag;

  renderSummary(questions, reviewList);
  document.getElementById("downloadJsonBtn").disabled = false;
  document.getElementById("downloadZipBtn").disabled =
    Object.keys(assetBag).length === 0;
});

async function parseByExtension(file, ext) {
  const arrayBuffer = await file.arrayBuffer();

  switch (ext) {
    case "csv":
      return Parsers.parseCSV(await file.text(), file.name);
    case "txt":
      return Parsers.parseTXT(await file.text(), file.name);
    case "rtf":
      return Parsers.parseRTF(await file.text(), file.name);
    case "docx":
      // DOCX目前回傳raw_html，需人工確認切分規則後再接入正式流程
      return [await Parsers.parseDOCX(arrayBuffer, file.name)];
    case "xlsx":
      return await Parsers.parseExcel(arrayBuffer, file.name);
    case "pdf":
      return await Parsers.parsePDF(arrayBuffer, file.name);
    default:
      console.warn(`不支援的格式: ${ext}`);
      return [];
  }
}

function renderSummary(questions, reviewList) {
  const summaryEl = document.getElementById("summary");
  summaryEl.innerHTML = `
    <p>總題數: ${questions.length}</p>
    <p>需人工覆核: ${reviewList.length}</p>
  `;

  const listEl = document.getElementById("reviewList");
  listEl.innerHTML = "";
  reviewList.forEach((q) => {
    const li = document.createElement("li");
    li.textContent = `[${q.id}] ${q.question.slice(0, 40)}... ${
      q._errors ? "錯誤: " + q._errors.join(", ") : "(含圖片,需確認對應)"
    }`;
    listEl.appendChild(li);
  });
}

document.getElementById("downloadJsonBtn").addEventListener("click", () => {
  Core.downloadJSON(allQuestions);
});

document.getElementById("downloadZipBtn").addEventListener("click", () => {
  Core.downloadAssetsZip(currentAssetBag);
});
