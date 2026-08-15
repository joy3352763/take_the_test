// main.js — v2: 兩階段流程
// Step1 分析格式 -> Step2 人工確認切題分界/答案標記+預覽 -> Step3 確認轉換 -> 結果/下載

let textSources = [];       // [{fullText, pageBoundaries, filename}] 來自 pdf/txt/rtf
let structuredQuestions = []; // 來自 csv/xlsx，已經是完整schema
let pendingDocx = [];        // 來自 docx，raw_html，需另外人工處理
let allQuestions = [];
let currentAssetBag = {};

document.getElementById("analyzeBtn").addEventListener("click", async () => {
  textSources = [];
  structuredQuestions = [];
  pendingDocx = [];

  const files = document.getElementById("fileInput").files;
  if (!files.length) {
    alert("請先選擇檔案");
    return;
  }

  for (const file of files) {
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      if (["pdf", "txt", "rtf"].includes(ext)) {
        const src = await Parsers.extractRawText(file, ext);
        textSources.push(src);
      } else if (ext === "csv") {
        structuredQuestions.push(...Parsers.parseCSV(await file.text(), file.name));
      } else if (ext === "xlsx") {
        structuredQuestions.push(...(await Parsers.parseExcel(await file.arrayBuffer(), file.name)));
      } else if (ext === "docx") {
        pendingDocx.push(await Parsers.parseDOCX(await file.arrayBuffer(), file.name));
      } else {
        console.warn(`不支援的格式: ${ext}`);
      }
    } catch (e) {
      console.error(`讀取 ${file.name} 失敗:`, e);
    }
  }

  if (textSources.length === 0) {
    await finalizeAndRender([...structuredQuestions]);
    return;
  }

  const combinedText = textSources.map((s) => s.fullText).join("\n\n");
  renderDelimiterCandidates(Parsers.detectDelimiterCandidates(combinedText));
  renderAnswerLabelCandidates(Parsers.detectAnswerLabelCandidates(combinedText));
  document.getElementById("step2").style.display = "block";
});

function renderDelimiterCandidates(candidates) {
  const container = document.getElementById("delimiterOptions");
  container.innerHTML = "";
  candidates.forEach((c, i) => {
    const label = document.createElement("label");
    label.style.display = "block";
    label.innerHTML = `<input type="radio" name="delimiter" value="${c.key}" ${i === 0 ? "checked" : ""}> ${c.label}（命中 ${c.count} 次）`;
    container.appendChild(label);
  });
  container.dataset.candidates = JSON.stringify(
    candidates.map((c) => ({ key: c.key, source: c.regex.source, flags: c.regex.flags }))
  );
}

function renderAnswerLabelCandidates(candidates) {
  const container = document.getElementById("answerLabelOptions");
  container.innerHTML = "";
  candidates.forEach((c) => {
    const label = document.createElement("label");
    label.style.display = "block";
    const checked = c.count > 0 ? "checked" : "";
    label.innerHTML = `<input type="checkbox" name="answerLabel" value="${c.pattern}" ${checked}> ${c.label}（命中 ${c.count} 次）`;
    container.appendChild(label);
  });
}

function getSelectedDelimiterRegex() {
  const custom = document.getElementById("customDelimiter").value.trim();
  if (custom) {
    try {
      return new RegExp(custom, "gi");
    } catch (e) {
      alert("自訂regex格式錯誤: " + e.message);
      throw e;
    }
  }
  const container = document.getElementById("delimiterOptions");
  const candidates = JSON.parse(container.dataset.candidates || "[]");
  const selected = container.querySelector('input[name="delimiter"]:checked');
  const found = candidates.find((c) => c.key === selected.value);
  return new RegExp(found.source, found.flags);
}

function getSelectedAnswerLabels() {
  const checked = document.querySelectorAll('input[name="answerLabel"]:checked');
  return Array.from(checked).map((el) => el.value);
}

document.getElementById("previewBtn").addEventListener("click", () => {
  const delimiterRegex = getSelectedDelimiterRegex();
  const blocks = Parsers.splitByDelimiter(textSources[0].fullText, delimiterRegex).slice(0, 3);
  const previewEl = document.getElementById("previewArea");
  previewEl.innerHTML = `<p>共切出 ${Parsers.splitByDelimiter(textSources[0].fullText, delimiterRegex).length} 個區塊，以下是前3個預覽：</p>`;
  blocks.forEach((b, i) => {
    const pre = document.createElement("pre");
    pre.style.border = "1px solid #ccc";
    pre.style.padding = "8px";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = `[區塊 ${i + 1}]\n` + b.text.slice(0, 400);
    previewEl.appendChild(pre);
  });
  document.getElementById("confirmConvertBtn").disabled = false;
});

document.getElementById("confirmConvertBtn").addEventListener("click", async () => {
  const delimiterRegex = getSelectedDelimiterRegex();
  const answerLabels = getSelectedAnswerLabels();
  let textQuestions = [];

  for (const src of textSources) {
    const blocks = Parsers.splitByDelimiter(src.fullText, delimiterRegex);
    for (let i = 0; i < blocks.length; i++) {
      const q = Parsers.parseBlockToQuestion(blocks[i].text, src.filename, i, answerLabels);

      if (src.pageBoundaries && src.pageBoundaries.length) {
        const overlapping = src.pageBoundaries.filter(
          (pb) => pb.startOffset < blocks[i].end && pb.endOffset > blocks[i].start
        );
        const withImage = overlapping.find((pb) => pb.hasImage);
        if (withImage) {
          try {
            q.question_image = await Parsers.renderPageImage(withImage.pdfPageRef);
            q.needs_review = true; // 整頁截圖，需人工確認/裁切
          } catch (e) {
            console.warn("頁面截圖失敗:", e);
          }
        }
      }
      textQuestions.push(q);
    }
  }

  await finalizeAndRender([...structuredQuestions, ...textQuestions]);
});

async function finalizeAndRender(collected) {
  const { questions, assetBag, reviewList } = Core.processQuestions(collected);
  allQuestions = questions;
  currentAssetBag = assetBag;

  allQuestions = allQuestions.concat(pendingDocx);
  const fullReviewList = reviewList.concat(pendingDocx);

  renderSummary(allQuestions, fullReviewList);
  document.getElementById("downloadJsonBtn").disabled = false;
  document.getElementById("downloadZipBtn").disabled = Object.keys(assetBag).length === 0;
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
    const text = q.question ? q.question.slice(0, 40) : "(DOCX原始HTML，需另外整理)";
    li.textContent = `[${q.id || q.source?.file}] ${text}... ${
      q._errors ? "錯誤: " + q._errors.join(", ") : q.question_image ? "(含整頁截圖,需確認/裁切)" : ""
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
