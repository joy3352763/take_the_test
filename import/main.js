// main.js v3: adds noise-candidate confirmation step before splitting
let textSources = [];
let structuredQuestions = [];
let pendingDocx = [];
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
        console.warn("unsupported ext: " + ext);
      }
    } catch (e) {
      console.error("read failed: " + file.name, e);
    }
  }
  if (textSources.length === 0) {
    await finalizeAndRender([...structuredQuestions]);
    return;
  }
  const combinedText = textSources.map((s) => s.fullText).join("\n\n");
  renderDelimiterCandidates(Parsers.detectDelimiterCandidates(combinedText));
  renderAnswerLabelCandidates(Parsers.detectAnswerLabelCandidates(combinedText));
  const mergedFreq = {};
  let totalPages = 0;
  textSources.forEach((s) => {
    totalPages += s.numPages || 0;
    Object.entries(s.pageFrequency || {}).forEach(([k, v]) => {
      mergedFreq[k] = (mergedFreq[k] || 0) + v;
    });
  });
  const noiseCandidates = totalPages > 0 ? Parsers.detectNoiseCandidates(mergedFreq, totalPages) : [];
  renderNoiseCandidates(noiseCandidates);
  if (window.RTFConventions) {
    renderExplanationLabelCandidates(RTFConventions.detectExplanationLabelCandidates(combinedText));
  }
  document.getElementById("step2").style.display = "block";
});

function ensureExplanationContainer() {
  let container = document.getElementById("explanationLabelOptions");
  if (!container) {
    const heading = document.createElement("h3");
    heading.textContent = "詳解/Explanation 標記格式（可多選）";
    container = document.createElement("div");
    container.id = "explanationLabelOptions";
    const step2 = document.getElementById("step2");
    step2.appendChild(heading);
    step2.appendChild(container);
  }
  return container;
}

function renderExplanationLabelCandidates(candidates) {
  const container = ensureExplanationContainer();
  container.innerHTML = "";
  candidates.forEach((c) => {
    const label = document.createElement("label");
    label.style.display = "block";
    const checked = c.count > 0 ? "checked" : "";
    label.innerHTML = '<input type="checkbox" name="explanationLabel" value="' + c.label.replace(/:$/, "") + '" ' + checked + '> ' + c.label + " (命中 " + c.count + " 次)";
    container.appendChild(label);
  });
}

function getSelectedExplanationLabels() {
  const checked = document.querySelectorAll('input[name="explanationLabel"]:checked');
  return Array.from(checked).map((el) => el.value);
}

function getSelectedConvention() {
  if (!window.RTFConventions) return null;
  const container = document.getElementById("delimiterOptions");
  const selected = container.querySelector('input[name="delimiter"]:checked');
  if (selected && selected.value === "q_short") {
    return RTFConventions.EXAM_FORMATTER_RTF_CONVENTION;
  }
  return RTFConventions.PDF_DEFAULT_CONVENTION;
}

function renderDelimiterCandidates(candidates) {
  const container = document.getElementById("delimiterOptions");
  container.innerHTML = "";
  candidates.forEach((c, i) => {
    const label = document.createElement("label");
    label.style.display = "block";
    label.innerHTML = '<input type="radio" name="delimiter" value="' + c.key + '" ' + (i === 0 ? "checked" : "") + '> ' + c.label + " (命中 " + c.count + " 次)";
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
    label.innerHTML = '<input type="checkbox" name="answerLabel" value="' + c.label.replace(/:$/, "") + '" ' + checked + '> ' + c.label + " (命中 " + c.count + " 次)";
    container.appendChild(label);
  });
}

function renderNoiseCandidates(candidates) {
  const container = document.getElementById("noiseOptions");
  container.innerHTML = "";
  if (!candidates.length) {
    container.innerHTML = "<p>未偵測到可疑的重複文字。</p>";
    return;
  }
  candidates.forEach((c, i) => {
    const label = document.createElement("label");
    label.style.display = "block";
    const pct = Math.round(c.ratio * 100);
    const preview = c.text.length > 40 ? c.text.slice(0, 40) + "..." : c.text;
    label.innerHTML = '<input type="checkbox" name="noiseCandidate" value="' + i + '"> [' + pct + "% 頁重複] " + preview;
    container.appendChild(label);
  });
  container.dataset.candidates = JSON.stringify(candidates);
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

function getSelectedNoiseStrings() {
  const container = document.getElementById("noiseOptions");
  const candidates = JSON.parse(container.dataset.candidates || "[]");
  const checked = document.querySelectorAll('input[name="noiseCandidate"]:checked');
  return Array.from(checked).map((el) => candidates[parseInt(el.value, 10)].text);
}

function applyNoiseRemoval(fullText) {
  const noiseStrings = getSelectedNoiseStrings();
  return noiseStrings.length ? Parsers.removeNoiseStrings(fullText, noiseStrings) : fullText;
}

document.getElementById("previewBtn").addEventListener("click", () => {
  const delimiterRegex = getSelectedDelimiterRegex();
  const cleanedText = applyNoiseRemoval(textSources[0].fullText);
  const allBlocks = Parsers.splitByDelimiter(cleanedText, delimiterRegex);
  const blocks = allBlocks.slice(0, 3);
  const previewEl = document.getElementById("previewArea");
  previewEl.innerHTML = "<p>共切出 " + allBlocks.length + " 個區塊，以下是前3個預覽：</p>";
  blocks.forEach((b, i) => {
    const pre = document.createElement("pre");
    pre.style.border = "1px solid #ccc";
    pre.style.padding = "8px";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = "[區塊 " + (i + 1) + "]\n" + b.text.slice(0, 400);
    previewEl.appendChild(pre);
  });
  document.getElementById("confirmConvertBtn").disabled = false;
});

// Resolves \pict image indexes (issue #20) against a text-source's extracted images[]
// (produced by Parsers.extractPictImages/stripRTF for RTF files) into data URIs. Vector
// formats (EMF/WMF) aren't convertible to a displayable format yet, so they're dropped
// here -- the question stays flagged needs_review via rtf-conventions.js's hasImage
// handling regardless, since dropping an image should never silently look "complete".
function resolveImageIndexes(indexes, images) {
  return (indexes || [])
    .map((idx) => {
      const img = images && images[idx];
      if (!img || !img.base64 || img.isVector) return null;
      const mime = img.ext === "jpg" ? "jpeg" : img.ext;
      return "data:image/" + mime + ";base64," + img.base64;
    })
    .filter(Boolean);
}

document.getElementById("confirmConvertBtn").addEventListener("click", async () => {
  const delimiterRegex = getSelectedDelimiterRegex();
  const answerLabels = getSelectedAnswerLabels();
  const noiseStrings = getSelectedNoiseStrings();
  const explanationLabels = window.RTFConventions ? getSelectedExplanationLabels() : [];
  const convention = getSelectedConvention();
  let textQuestions = [];
  for (const src of textSources) {
    const cleanedText = noiseStrings.length ? Parsers.removeNoiseStrings(src.fullText, noiseStrings) : src.fullText;
    const blocks = Parsers.splitByDelimiter(cleanedText, delimiterRegex);
    for (let i = 0; i < blocks.length; i++) {
      const q = convention
        ? Parsers.parseBlockToQuestionV2(blocks[i].text, src.filename, i, answerLabels, explanationLabels, convention, delimiterRegex)
        : Parsers.parseBlockToQuestion(blocks[i].text, src.filename, i, answerLabels);

      if (src.images && src.images.length) {
        if (q.stem_image_indexes) q.img_stem_paths_raw = resolveImageIndexes(q.stem_image_indexes, src.images);
        if (q.option_image_indexes) {
          q.img_option_paths_raw = q.option_image_indexes.map((idxArr) => resolveImageIndexes(idxArr, src.images));
        }
        if (q.explanation_image_indexes) {
          q.img_explanation_paths_raw = resolveImageIndexes(q.explanation_image_indexes, src.images);
        }
      }

      if (src.pageBoundaries && src.pageBoundaries.length) {
        const overlapping = src.pageBoundaries.filter(
          (pb) => pb.startOffset < blocks[i].end && pb.endOffset > blocks[i].start
        );
        const withImage = overlapping.find((pb) => pb.hasImage);
        if (withImage) {
          try {
            q.question_image = await Parsers.renderPageImage(withImage.pdfPageRef);
            q.needs_review = true;
          } catch (e) {
            console.warn("page render failed:", e);
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
  summaryEl.innerHTML = "<p>總題數: " + questions.length + "</p><p>需人工覆核: " + reviewList.length + "</p>";
  const listEl = document.getElementById("reviewList");
  listEl.innerHTML = "";
  reviewList.forEach((q) => {
    const li = document.createElement("li");
    const text = q.question ? q.question.slice(0, 40) : "(DOCX raw HTML)";
    const extra = q._errors ? "錯誤: " + q._errors.join(", ") : q.question_image ? "(含整頁截圖,需確認/裁切)" : "";
    const label = q.delimiter_label || q.id || (q.source && q.source.file);
    li.textContent = "[" + label + "] " + text + "... " + extra;
    listEl.appendChild(li);
  });
}

document.getElementById("downloadJsonBtn").addEventListener("click", () => {
  Core.downloadJSON(allQuestions);
});

document.getElementById("downloadZipBtn").addEventListener("click", () => {
  Core.downloadAssetsZip(currentAssetBag);
});

window.getAllQuestions = () => allQuestions;
window.getTextSources = () => textSources;

(function () {
  const s1 = document.createElement("script");
  s1.src = "scriptjs-export.js";
  document.body.appendChild(s1);
  const s2 = document.createElement("script");
  s2.src = "rtf-conventions.js";
  document.body.appendChild(s2);
  const s3 = document.createElement("script");
  s3.src = "version.js";
  document.body.appendChild(s3);
})();
