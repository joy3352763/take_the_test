// parsers.js — v2: 支援互動式格式確認 + PDF整頁截圖 + hex指紋過濾
// 中介格式: { id, question, question_image, type, options, option_images, answers, source, needs_review }

const Parsers = {};

// ================= 通用：切題候選偵測 =================
Parsers.detectDelimiterCandidates = function (text) {
  const candidates = [
    { key: "q_no_dot", label: "QUESTION 数字（不含句點）", regex: /QUESTION\s+\d+(?!\s*\.)/gi },
    { key: "q_with_dot", label: "QUESTION 数字.", regex: /QUESTION\s+\d+\s*\./gi },
    { key: "q_any", label: "QUESTION 数字（不論後面符號）", regex: /QUESTION\s+\d+/gi },
    { key: "num_dot_line", label: "行首「數字.」", regex: /^\s*\d+\.\s+/gm },
    { key: "blank_line", label: "空行分隔（原始邏輯，通常不準）", regex: /\n\s*\n/g },
  ];
  return candidates.map((c) => ({ ...c, count: (text.match(c.regex) || []).length }));
};

Parsers.detectAnswerLabelCandidates = function (text) {
  const candidates = [
    { key: "correct_answer", label: "Correct Answer:", pattern: "Correct Answer" },
    { key: "answer", label: "Answer:", pattern: "Answer" },
    { key: "zh_answer", label: "答案:", pattern: "答案" },
  ];
  return candidates.map((c) => {
    const re = new RegExp(`^${c.pattern}\\s*[:\uff1a]`, "gim");
    return { ...c, count: (text.match(re) || []).length };
  });
};

// ================= 通用：依選定分界 regex切題 =================
// delimiterRegex 必須含 global flag
Parsers.splitByDelimiter = function (text, delimiterRegex) {
  const re = new RegExp(
    delimiterRegex.source,
    delimiterRegex.flags.includes("g") ? delimiterRegex.flags : delimiterRegex.flags + "g"
  );
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) {
    return [{ text, start: 0, end: text.length }];
  }
  const blocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    blocks.push({ text: text.slice(start, end), start, end });
  }
  return blocks;
};

// ================= 通用：單一區塊 -> 題目物件 =================
// answerLabels: 使用者勾選的答案標記文字陣列，例如 ["Correct Answer", "Answer"]
Parsers.parseBlockToQuestion = function (blockText, filename, idx, answerLabels) {
  const lines = blockText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let question = lines[0] || "";
  question = question.replace(/^(QUESTION\s+\d+\s*\.?|^\d+\.)\s*/i, "").trim();
  let bodyLines = lines.slice(1);
  if (!question && bodyLines.length) {
    question = bodyLines[0];
    bodyLines = bodyLines.slice(1);
  }

  const optionLines = bodyLines.filter((l) => /^[A-J]\s*[.\u3001)]/.test(l));
  const options = optionLines.map((l) => l.replace(/^[A-J]\s*[.\u3001)]\s*/, "").trim());

  const labels = answerLabels && answerLabels.length ? answerLabels : ["Correct Answer", "Answer", "答案"];
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const answerRegex = new RegExp(`^(?:${escaped.join("|")})\\s*[:\uff1a]\\s*(.*)$`, "i");

  let answerLetters = "";
  for (const l of bodyLines) {
    const m = l.match(answerRegex);
    if (m) {
      answerLetters = m[1];
      break;
    }
  }
  const answers = answerLetters
    .split("")
    .filter((c) => /[A-J]/i.test(c))
    .map((c) => c.toUpperCase().charCodeAt(0) - 65);

  return {
    id: `${filename.replace(/\W+/g, "_")}_${idx}`,
    question,
    question_image: null,
    type: answers.length > 1 ? "multiple" : "single",
    options,
    option_images: options.map(() => null),
    answers,
    source: { file: filename, block: idx },
    needs_review: options.length === 0 || answers.length === 0,
  };
};

// ================= CSV / TXT（結構明確時可直接用）=================
Parsers.parseCSV = function (text, filename) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1);
  return rows.map((line, idx) => {
    const cells = line.split(","); // TODO: 換成正式CSV parser處理引號內逗號
    const rec = {};
    header.forEach((h, i) => (rec[h.trim()] = (cells[i] || "").trim()));
    const options = Object.keys(rec)
      .filter((k) => /^option\d+$/.test(k) && rec[k])
      .map((k) => rec[k]);
    const answers = (rec.answer || "")
      .split(/[;,]/)
      .filter(Boolean)
      .map((n) => parseInt(n, 10));
    return {
      id: `csv_${idx}`,
      question: rec.question || "",
      question_image: null,
      type: rec.type === "multiple" ? "multiple" : "single",
      options,
      option_images: options.map(() => null),
      answers,
      source: { file: filename, line: idx + 2 },
      needs_review: options.length === 0,
    };
  });
};

// ================= RTF：去除控制字元拿純文字，圖片先跳過標記 =================
Parsers.stripRTF = function (rtfRaw) {
  const pictBlocks = (rtfRaw.match(/\{\\pict[\s\S]*?\}\}/g) || []).length;
  const plainText = rtfRaw
    .replace(/\{\\pict[\s\S]*?\}\}/g, "[IMAGE]")
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "");
  return { plainText, pictBlocks };
};

// ================= 浮水印/防皣追踪指紋過濾 =================
// 32位hex字串（近似MD5格式）視為每份PDF唯一的追踪碼，而非固定字串，用格式判斷而非字串清單
function isWatermarkSpan(item) {
  return /^[0-9A-F]{32}$/i.test(item.str.trim());
}

// ================= PDF：抽文字 + 記錄每頁offset + 偵測含圖片頁 =================
// 回傳 {fullText, pageBoundaries, filename}，不在此直接切題，交給main.js做互動式確認
Parsers.extractPDFText = async function (arrayBuffer, filename) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  const pageBoundaries = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const filtered = textContent.items.filter((item) => !isWatermarkSpan(item));
    const pageText = filtered.map((item) => item.str).join(" ") + "\n\n";

    const startOffset = fullText.length;
    fullText += pageText;
    const endOffset = fullText.length;

    const opList = await page.getOperatorList();
    const hasImage = opList.fnArray.some(
      (fn) =>
        fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintJpegXObject ||
        fn === pdfjsLib.OPS.paintImageMaskXObject
    );

    pageBoundaries.push({ page: p, startOffset, endOffset, hasImage, pdfPageRef: page });
  }

  return { fullText, pageBoundaries, filename };
};

// 依需要才把某一頁rasterize成截圖（簡化版圖片方案：整頁截圖，不做精準裁切）
Parsers.renderPageImage = async function (page, scale = 1.5) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
};

// 統一入口：pdf/txt/rtf 都走「抽原始文字+頁面資訊」，交給main.js的互動式pipeline
Parsers.extractRawText = async function (file, ext) {
  if (ext === "pdf") {
    const arrayBuffer = await file.arrayBuffer();
    return await Parsers.extractPDFText(arrayBuffer, file.name);
  }
  if (ext === "rtf") {
    const raw = await file.text();
    const { plainText } = Parsers.stripRTF(raw);
    return { fullText: plainText, pageBoundaries: [], filename: file.name };
  }
  // txt
  const text = await file.text();
  return { fullText: text, pageBoundaries: [], filename: file.name };
};

// ================= DOCX (mammoth.js) — 仍為半自動，需人工確認切分規則 =================
Parsers.parseDOCX = async function (arrayBuffer, filename) {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(function (image) {
        return image.read("base64").then(function (imageBuffer) {
          return { src: "data:" + image.contentType + ";base64," + imageBuffer };
        });
      }),
    }
  );
  return {
    raw_html: result.value,
    messages: result.messages,
    needs_review: true,
    source: { file: filename },
  };
};

// ================= Excel (ExcelJS) =================
Parsers.parseExcel = async function (arrayBuffer, filename) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];

  const imageMap = {};
  sheet.getImages().forEach((img) => {
    const media = workbook.model.media.find((m) => m.index === img.imageId);
    const dataUri = `data:image/${media.extension};base64,${media.buffer.toString("base64")}`;
    const row = Math.round(img.range.tl.row);
    imageMap[row] = dataUri;
  });

  const questions = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (col) => row.getCell(col).text || "";
    const options = [];
    for (let i = 1; i <= 10; i++) {
      const val = get(`option${i}`);
      if (val) options.push(val);
    }
    const answers = get("answer")
      .split(/[;,]/)
      .filter(Boolean)
      .map((n) => parseInt(n, 10));
    questions.push({
      id: `xlsx_row${rowNumber}`,
      question: get("question"),
      question_image: imageMap[rowNumber - 1] || null,
      type: get("type") === "multiple" ? "multiple" : "single",
      options,
      option_images: options.map(() => null),
      answers,
      source: { file: filename, row: rowNumber },
      needs_review: options.length === 0 || answers.length === 0,
    });
  });
  return questions;
};
