// db-bridge.js — bridges import/main.js's in-memory question list into the review
// editor's shared IndexedDB (issue #23 方案 A / #24).
//
// Design: this does NOT touch main.js's parsing/rendering logic. It only reads the
// already-stable public API `window.getAllQuestions()` (exposed since the #5 pending-
// problem-1 fix) and `window.getTextSources()` (exposed since #12), converts the
// in-memory question objects into db.js's schema, and writes them via DB.putQuestions()/
// DB.putImage(). Loaded the same way as scriptjs-export.js/rtf-conventions.js/version.js:
// a dynamically injected <script> tag from main.js's tail IIFE, so import.html did not
// need to be edited, and a self-mounted button so import.html's markup stays untouched.

const DbBridge = {};

// main.js's image-resolution step (issue #20, resolveImageIndexes in confirmConvertBtn's
// handler) attaches arrays of data-URI strings to each question:
//   q.img_stem_paths_raw          -- data URIs for the question stem
//   q.img_option_paths_raw[i]     -- array of data URIs per option, index-aligned with q.options
//   q.img_explanation_paths_raw   -- data URIs for the explanation
// plus the older q.question_image (PDF full-page screenshot data URI, issue #5).
// db.js's schema (and the CSV schema scriptjs-export.js targets) wants a single path
// string per slot (img_stem/img_optA-D/img_explain), so this only takes the FIRST data
// URI per slot for now -- multi-image-per-slot support is a follow-up if it turns out to
// be needed in practice.
DbBridge.dataUriToBlob = function (dataUri) {
  const match = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

DbBridge.extFromMime = function (mime) {
  const m = (mime || "").split("/")[1] || "bin";
  return m === "jpeg" ? "jpg" : m;
};

// Writes one image slot (if present) into the images store and returns the path string
// to store on the question row, or null if there's nothing to write for this slot.
DbBridge.writeImageSlot = async function (questionId, slot, dataUris) {
  if (!dataUris || !dataUris.length || !dataUris[0]) return null;
  const blob = DbBridge.dataUriToBlob(dataUris[0]);
  if (!blob) return null;
  const ext = DbBridge.extFromMime(blob.type);
  const path = `assets/${questionId}_${slot}.${ext}`;
  await DB.putImage(path, blob);
  return path;
};

const OPTION_SLOTS = ["optA", "optB", "optC", "optD"];

DbBridge.toReviewRecord = async function (q) {
  const img_stem = await DbBridge.writeImageSlot(
    q.id,
    "stem",
    q.img_stem_paths_raw || (q.question_image ? [q.question_image] : [])
  );
  const optionImagePaths = {};
  if (q.img_option_paths_raw) {
    for (let i = 0; i < OPTION_SLOTS.length; i++) {
      optionImagePaths[OPTION_SLOTS[i]] = await DbBridge.writeImageSlot(
        q.id,
        OPTION_SLOTS[i],
        q.img_option_paths_raw[i]
      );
    }
  }
  const img_explain = await DbBridge.writeImageSlot(q.id, "explain", q.img_explanation_paths_raw);

  return {
    id: q.id,
    question: q.question || "",
    delimiter_label: q.delimiter_label || null,
    options: q.options || [],
    answers: q.answers || [],
    explanation: q.explanation || "",
    img_stem,
    img_optA: optionImagePaths.optA || null,
    img_optB: optionImagePaths.optB || null,
    img_optC: optionImagePaths.optC || null,
    img_optD: optionImagePaths.optD || null,
    img_explain,
    source: q.source || null,
    needs_review: !!q.needs_review,
    _errors: q._errors || null,
    reviewStatus: "pending",
    reviewNote: "",
  };
};

DbBridge.writeAllToReviewDB = async function (statusEl) {
  const questions = typeof window.getAllQuestions === "function" ? window.getAllQuestions() : [];
  if (!questions.length) {
    if (statusEl) statusEl.textContent = "目前沒有可寫入的題目，請先完成轉換。";
    return { written: 0 };
  }

  const batchSize = await DB.getBatchSize();
  let written = 0;

  for (let i = 0; i < questions.length; i += batchSize) {
    const chunk = questions.slice(i, i + batchSize);
    if (statusEl) {
      statusEl.textContent = `寫入覆核 DB 中… 第 ${Math.floor(i / batchSize) + 1}/${Math.ceil(questions.length / batchSize)} 批`;
    }
    const records = await Promise.all(chunk.map((q) => DbBridge.toReviewRecord(q)));
    await DB.putQuestions(records);
    written += records.length;
  }

  if (statusEl) statusEl.textContent = `已寫入 ${written} 題到覆核 DB，可以到 review.html 開始覆核。`;
  return { written };
};

// Self-mounting button, same pattern as scriptjs-export.js's downloadScriptCsvBtn,
// so import.html's markup doesn't need to change.
(function () {
  const btn = document.createElement("button");
  btn.id = "writeToReviewDbBtn";
  btn.textContent = "寫入覆核用資料庫（IndexedDB）";
  btn.style.marginLeft = "8px";

  const status = document.createElement("span");
  status.id = "writeToReviewDbStatus";
  status.style.marginLeft = "8px";
  status.style.color = "#555";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await DbBridge.writeAllToReviewDB(status);
    } catch (e) {
      status.textContent = "寫入失敗: " + e.message;
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  });

  document.body.appendChild(btn);
  document.body.appendChild(status);
})();
