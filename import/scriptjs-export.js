// scriptjs-export.js
// Bridges the import-tool's intermediate schema (English keys, 0-based `answers` index array)
// to the flat schema that the main quiz app's script.js already parses from CSV/XLSX
// (Chinese keys 題型/題目/選項N/答案, with 答案 as 1-based numbers OR letters A-D,
// dot-joined for multi-select — see script.js's `ansMap` + `isAnswerCorrect()`).
//
// This resolves the pending compatibility issue: the import tool previously exported
// `answers: [0, 2]` (0-based array indices), but script.js expects `答案: "1.3"` (1-based).
// Loaded dynamically by main.js after conversion so it has no effect on existing parsing logic.

const ScriptJSExport = {};

// 0-based indices -> "1" or "1.3" (1-based, dot-joined) matching script.js's 答案 format
ScriptJSExport.answersToScriptFormat = function (answers) {
  return (answers || [])
    .slice()
    .sort((a, b) => a - b)
    .map((i) => i + 1)
    .join(".");
};

// Assigns a sequential 1-based question number (題號) to every exported row, so
// script.js's "range" exam-scope mode -- which filters on parseInt(q.題號) -- has
// something to filter on. The import tool's intermediate schema never carried a question
// number (issue #14: manually-built CSV/XLSX question banks include 題號, but anything
// produced by parseBlockToQuestion(V2) did not), so it is generated fresh here.
ScriptJSExport.toRows = function (questions) {
  const rows = [];
  const skipped = [];
  let questionNumber = 0;
  (questions || []).forEach((q) => {
    if (q.needs_review || !q.options || q.options.length === 0 || !q.answers || q.answers.length === 0) {
      skipped.push(q);
      return;
    }
    questionNumber++;
    const row = {
      題號: questionNumber,
      題型: "選擇題",
      題目: q.question,
      答案: ScriptJSExport.answersToScriptFormat(q.answers),
    };
    q.options.forEach((opt, i) => {
      row["選項" + (i + 1)] = opt;
    });
    if (q.explanation) row.解析 = q.explanation;
    rows.push(row);
  });
  return { rows, skipped };
};

// Minimal CSV serializer (handles comma/quote/newline escaping) with a UTF-8 BOM
// so Papa.parse (used by script.js) reads the Chinese headers correctly.
ScriptJSExport.rowsToCSV = function (rows) {
  if (!rows.length) return "";
  const headerSet = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
  const optionKeys = [...headerSet]
    .filter((k) => /^選項\d+$/.test(k))
    .sort((a, b) => parseInt(a.replace("選項", ""), 10) - parseInt(b.replace("選項", ""), 10));
  const knownKeys = ["題號", "題型", "題目", ...optionKeys, "答案"];
  const restKeys = [...headerSet].filter((k) => !knownKeys.includes(k));
  const headers = [...knownKeys, ...restKeys];

  function escapeCell(val) {
    const s = val === undefined || val === null ? "" : String(val);
    if (/[",\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const lines = [headers.map(escapeCell).join(",")];
  rows.forEach((r) => {
    lines.push(headers.map((h) => escapeCell(r[h])).join(","));
  });
  return "\uFEFF" + lines.join("\r\n");
};

ScriptJSExport.downloadCSV = function (questions, filename) {
  filename = filename || "questions_for_script_js.csv";
  const { rows, skipped } = ScriptJSExport.toRows(questions);
  if (skipped.length) {
    console.warn(skipped.length + " question(s) skipped (needs_review or missing options/answers), not written to CSV:", skipped);
  }
  const csv = ScriptJSExport.rowsToCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { exported: rows.length, skipped: skipped.length };
};

// Self-mounting button so import.html doesn't need to be edited.
(function () {
  const btn = document.createElement("button");
  btn.id = "downloadScriptCsvBtn";
  btn.textContent = "\u4e0b\u8f09 script.js \u76f8\u5bb9 CSV\uff08\u4fee\u6b63\u7b54\u6848 index\uff09";
  btn.style.marginLeft = "8px";
  btn.addEventListener("click", () => {
    const qs = typeof window.getAllQuestions === "function" ? window.getAllQuestions() : [];
    if (!qs.length) {
      alert("\u76ee\u524d\u6c92\u6709\u53ef\u532f\u51fa\u7684\u984c\u76ee\uff0c\u8acb\u5148\u5b8c\u6210\u8f49\u63db\u3002");
      return;
    }
    const result = ScriptJSExport.downloadCSV(qs);
    console.log("script.js-compatible CSV exported:", result);
  });
  document.body.appendChild(btn);
})();
