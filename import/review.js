// review.js — 覆核編輯器骨架 (issue #23 方案 A)
//
// 目前狀態：main.js 已透過 db-bridge.js 寫入資料（見 #23/#24），這裡負責覆核 UI、
// 狀態機寫回、以及批次匯出。

const activeObjectUrls = [];

function revokeActiveObjectUrls() {
  // issue #23 第4點：縮圖預覽用完要 revoke，避免物件累積在記憶體裡
  while (activeObjectUrls.length) {
    URL.revokeObjectURL(activeObjectUrls.pop());
  }
}

async function blobToObjectUrl(blob) {
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  activeObjectUrls.push(url);
  return url;
}

let currentOffset = 0;
let currentBatchSize = 150;
let currentStatusFilter = "pending";

async function refreshSummary() {
  const counts = await DB.countAllByStatus();
  document.getElementById("summaryCounts").textContent =
    `待審 ${counts.pending} ・ 已核准 ${counts.approved} ・ 需修正 ${counts.needs_fix} ・ 已退回 ${counts.rejected}`;
  return counts;
}

async function renderImageField(container, label, path) {
  if (!path) return;
  const blob = await DB.getImageBlob(path);
  if (!blob) {
    const missing = document.createElement("p");
    missing.className = "review-img-missing";
    missing.textContent = `${label}: 圖片遺失 (${path})`;
    container.appendChild(missing);
    return;
  }
  const url = await blobToObjectUrl(blob);
  const wrap = document.createElement("div");
  wrap.className = "review-img-wrap";
  const caption = document.createElement("div");
  caption.className = "review-img-caption";
  caption.textContent = label;
  const img = document.createElement("img");
  img.src = url;
  img.className = "review-img-thumb";
  img.loading = "lazy";
  wrap.appendChild(caption);
  wrap.appendChild(img);
  container.appendChild(wrap);
}

async function renderQuestionCard(q) {
  const card = document.createElement("div");
  card.className = "review-card";
  card.dataset.id = q.id;

  const title = document.createElement("div");
  title.className = "review-card-title";
  title.textContent = `[${q.delimiter_label || q.id}] ${q.question || "(無題幹文字)"}`;
  card.appendChild(title);

  const badge = document.createElement("span");
  badge.className = q.needs_review ? "review-badge review-badge-flagged" : "review-badge review-badge-clean";
  badge.textContent = q.needs_review ? "⚠ 解析時有旗標" : "✓ 解析時無旗標";
  card.appendChild(badge);

  if (q._errors && q._errors.length) {
    const err = document.createElement("div");
    err.className = "review-card-errors";
    err.textContent = "解析錯誤: " + q._errors.join(", ");
    card.appendChild(err);
  }

  const optionsEl = document.createElement("ol");
  optionsEl.className = "review-card-options";
  (q.options || []).forEach((opt, i) => {
    const li = document.createElement("li");
    const isAnswer = (q.answers || []).includes(i);
    li.textContent = opt + (isAnswer ? "  ✅" : "");
    optionsEl.appendChild(li);
  });
  card.appendChild(optionsEl);

  const imagesEl = document.createElement("div");
  imagesEl.className = "review-card-images";
  await renderImageField(imagesEl, "題幹圖", q.img_stem);
  await renderImageField(imagesEl, "選項A圖", q.img_optA);
  await renderImageField(imagesEl, "選項B圖", q.img_optB);
  await renderImageField(imagesEl, "選項C圖", q.img_optC);
  await renderImageField(imagesEl, "選項D圖", q.img_optD);
  await renderImageField(imagesEl, "解析圖", q.img_explain);
  card.appendChild(imagesEl);

  if (q.explanation) {
    const exp = document.createElement("div");
    exp.className = "review-card-explanation";
    exp.textContent = "解析: " + q.explanation;
    card.appendChild(exp);
  }

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.placeholder = "備註（選填）";
  noteInput.className = "review-card-note";
  noteInput.value = q.reviewNote || "";
  card.appendChild(noteInput);

  const actions = document.createElement("div");
  actions.className = "review-card-actions";

  function makeButton(label, status) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "review-btn review-btn-" + status;
    btn.addEventListener("click", async () => {
      await DB.updateReviewStatus(q.id, status, noteInput.value);
      card.classList.add("review-card-done");
      card.dataset.reviewedAs = status;
      await refreshSummary();
    });
    return btn;
  }

  actions.appendChild(makeButton("核准", "approved"));
  actions.appendChild(makeButton("需修正", "needs_fix"));
  actions.appendChild(makeButton("退回", "rejected"));
  card.appendChild(actions);

  return card;
}

async function loadCurrentPage() {
  revokeActiveObjectUrls();
  const listEl = document.getElementById("reviewCardList");
  listEl.innerHTML = "";

  const questions = await DB.getQuestionsByStatus(
    currentStatusFilter,
    currentOffset,
    currentBatchSize
  );

  if (!questions.length) {
    listEl.innerHTML = `<p class="review-empty">此篩選條件下目前沒有題目（狀態: ${currentStatusFilter}）。</p>`;
  }

  for (const q of questions) {
    const card = await renderQuestionCard(q);
    listEl.appendChild(card);
  }

  document.getElementById("pageInfo").textContent =
    `第 ${Math.floor(currentOffset / currentBatchSize) + 1} 頁（每頁 ${currentBatchSize} 題，篩選: ${currentStatusFilter}）`;
}

function wirePagerControls() {
  document.getElementById("prevPageBtn").addEventListener("click", () => {
    currentOffset = Math.max(0, currentOffset - currentBatchSize);
    loadCurrentPage();
  });
  document.getElementById("nextPageBtn").addEventListener("click", () => {
    currentOffset += currentBatchSize;
    loadCurrentPage();
  });
  document.getElementById("statusFilterSelect").addEventListener("change", (e) => {
    currentStatusFilter = e.target.value;
    currentOffset = 0;
    loadCurrentPage();
  });
  document.getElementById("applyBatchSizeBtn").addEventListener("click", async () => {
    const val = parseInt(document.getElementById("batchSizeInput").value, 10);
    currentBatchSize = Math.max(1, val || 150);
    await DB.setBatchSize(currentBatchSize);
    currentOffset = 0;
    loadCurrentPage();
  });

  document.getElementById("autoApproveBtn").addEventListener("click", async () => {
    const statusEl = document.getElementById("autoApproveStatus");
    statusEl.textContent = "處理中…";
    const result = await DB.autoApproveConfidentPending();
    statusEl.textContent = `已自動核准 ${result.approved} 題（解析時無旗標），剩餘 ${result.remainingPending} 題待人工確認。`;
    currentOffset = 0;
    await refreshSummary();
    await loadCurrentPage();
  });
}

function answersToScriptFormat(answers) {
  return (answers || [])
    .slice()
    .sort((a, b) => a - b)
    .map((i) => i + 1)
    .join(".");
}

function rowsToCSV(rows) {
  if (!rows.length) return "";
  const headerSet = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
  const optionKeys = [...headerSet]
    .filter((k) => /^選項\d+$/.test(k))
    .sort((a, b) => parseInt(a.replace("選項", ""), 10) - parseInt(b.replace("選項", ""), 10));
  const knownKeys = [
    "題號", "題型", "題目",
    ...optionKeys,
    "答案", "解析",
    "img_stem", "img_optA", "img_optB", "img_optC", "img_optD", "img_explain",
    "待確認",
  ];
  const restKeys = [...headerSet].filter((k) => !knownKeys.includes(k));
  const headers = [...knownKeys, ...restKeys];

  function escapeCell(val) {
    const s = val === undefined || val === null ? "" : String(val);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  const lines = [headers.map(escapeCell).join(",")];
  rows.forEach((r) => lines.push(headers.map((h) => escapeCell(r[h])).join(",")));
  return "\uFEFF" + lines.join("\r\n");
}

// 修正：題型必須固定寫「選擇題」(見 PR #29)。這裡又修正一個同类型的問題：題號不能直接拿
// delimiter_label(例如 "Q259")、也不能拿 q.id 這種非純數字字串。script.js 的範圍選題是靠
// `parseInt(q.題號)` 比大小，非純數字字串會被 parseInt 變成 NaN，範圍篩選永遠邀不到任何題目。
// 回到舊 `scriptjs-export.js`(issue #14)的約定：題號是匯出時重新指定的連續整數，與原始
// 檔案的分隔符文字完全無關。delimiter_label 仍留給覆核清單顯示用，不再拿來當題號。
async function exportBatchToZip(batch, batchIndex, startNumber) {
  const zip = new JSZip();
  const rows = [];
  const imgFields = ["img_stem", "img_optA", "img_optB", "img_optC", "img_optD", "img_explain"];

  for (let i = 0; i < batch.length; i++) {
    const q = batch[i];
    const row = {
      題號: startNumber + i,
      題型: "選擇題",
      題目: q.question,
      答案: answersToScriptFormat(q.answers),
      解析: q.explanation || "",
      待確認: "",
    };
    (q.options || []).forEach((opt, j) => (row["選項" + (j + 1)] = opt));

    for (const field of imgFields) {
      const path = q[field];
      row[field] = path || "";
      if (path) {
        const blob = await DB.getImageBlob(path);
        if (blob) zip.file(path, blob);
      }
    }
    rows.push(row);
  }

  zip.file(`batch_${String(batchIndex).padStart(3, "0")}.csv`, rowsToCSV(rows));

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `batch_${String(batchIndex).padStart(3, "0")}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportApproved() {
  const batchSize = await DB.getBatchSize();
  const batches = await DB.getApprovedQuestionsInBatches(batchSize);
  const statusEl = document.getElementById("exportStatus");

  if (!batches.length) {
    statusEl.textContent = "目前沒有已核准的題目可匯出。";
    return;
  }

  let nextNumber = 1;
  for (let i = 0; i < batches.length; i++) {
    statusEl.textContent = `匯出中… 第 ${i + 1}/${batches.length} 批（${batches[i].length} 題）`;
    await exportBatchToZip(batches[i], i + 1, nextNumber);
    nextNumber += batches[i].length;
  }
  statusEl.textContent = `匯出完成，共 ${batches.length} 批，總計 ${batches.reduce((s, b) => s + b.length, 0)} 題。`;
}

async function init() {
  currentBatchSize = await DB.getBatchSize();
  document.getElementById("batchSizeInput").value = currentBatchSize;
  wirePagerControls();
  document.getElementById("exportApprovedBtn").addEventListener("click", exportApproved);
  await refreshSummary();
  await loadCurrentPage();
}

window.addEventListener("DOMContentLoaded", init);
window.addEventListener("beforeunload", revokeActiveObjectUrls);
