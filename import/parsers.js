// parsers.js v5: noise candidates require user confirmation (only hex fingerprint auto-filtered)

const Parsers = {};

Parsers.detectDelimiterCandidates = function (text) {
  const candidates = [
    { key: "q_no_dot", label: "QUESTION number (no dot)", regex: /QUESTION\s+\d+(?!\s*\.)/gi },
    { key: "q_with_dot", label: "QUESTION number.", regex: /QUESTION\s+\d+\s*\./gi },
    { key: "q_any", label: "QUESTION number (any)", regex: /QUESTION\s+\d+/gi },
    { key: "num_dot_line", label: "Line-start number.", regex: /^\s*\d+\.\s+/gm },
    { key: "blank_line", label: "Blank line (legacy, usually inaccurate)", regex: /\n\s*\n/g },
  ];
  return candidates.map((c) => ({ ...c, count: (text.match(c.regex) || []).length }));
};

Parsers.detectAnswerLabelCandidates = function (text) {
  const candidates = [
    { key: "correct_answer", label: "Correct Answer:", pattern: "Correct Answer" },
    { key: "answer", label: "Answer:", pattern: "Answer" },
    { key: "zh_answer", label: "Answer (zh):", pattern: "\u7b54\u6848" },
  ];
  return candidates.map((c) => {
    const re = new RegExp(c.pattern + "\\s*[:\uff1a]", "gi");
    return { ...c, count: (text.match(re) || []).length };
  });
};

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

function findAnswerLetters(bodyLines, escapedLabels) {
  const labelRegex = new RegExp("^(?:" + escapedLabels.join("|") + ")\\s*[:\uff1a]\\s*(.*)$", "i");
  const letterRegex = /^[A-J](?:\s*,?\s*[A-J])*/i;

  for (let i = 0; i < bodyLines.length; i++) {
    const m = bodyLines[i].match(labelRegex);
    if (!m) continue;

    let rest = (m[1] || "").trim();
    let letterMatch = rest.match(letterRegex);
    if (!letterMatch && i + 1 < bodyLines.length) {
      letterMatch = bodyLines[i + 1].trim().match(letterRegex);
    }
    if (letterMatch) return letterMatch[0];
    return "";
  }
  return "";
}

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

  const labels = answerLabels && answerLabels.length ? answerLabels : ["Correct Answer", "Answer", "\u7b54\u6848"];
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const answerLetters = findAnswerLetters(bodyLines, escaped);
  const answers = answerLetters
    .replace(/[^A-J]/gi, "")
    .toUpperCase()
    .split("")
    .map((c) => c.charCodeAt(0) - 65);

  return {
    id: filename.replace(/\W+/g, "_") + "_" + idx,
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

Parsers.parseCSV = function (text, filename) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1);
  return rows.map((line, idx) => {
    const cells = line.split(",");
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
      id: "csv_" + idx,
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

// 只自動過濾hex指紋碼，其他重複文字都保留在fullText裡，區間掛頁頻率統計回傳給main.js讓使用者確認是否要手動濾掉
Parsers.extractPDFText = async function (arrayBuffer, filename) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  const pageItemsCache = [];
  const pageFrequency = {};

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    pageItemsCache.push({ page, items: textContent.items });

    const seenThisPage = new Set();
    textContent.items.forEach((item) => {
      const t = item.str.trim();
      if (!t || seenThisPage.has(t)) return;
      seenThisPage.add(t);
      pageFrequency[t] = (pageFrequency[t] || 0) + 1;
    });
  }

  function isHexFingerprint(str) {
    return /^[0-9A-F]{32}$/i.test(str.trim());
  }

  let fullText = "";
  const pageBoundaries = [];

  for (let i = 0; i < pageItemsCache.length; i++) {
    const { page, items } = pageItemsCache[i];
    let pageText = "";
    let lastY = null;

    items.forEach((item) => {
      if (isHexFingerprint(item.str)) return;
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        pageText += "\n";
      } else if (pageText && !/\s$/.test(pageText)) {
        pageText += " ";
      }
      pageText += item.str;
      if (y !== null) lastY = y;
    });

    const startOffset = fullText.length;
    fullText += pageText + "\n\n";
    const endOffset = fullText.length;

    const opList = await page.getOperatorList();
    const hasImage = opList.fnArray.some(
      (fn) =>
        fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintJpegXObject ||
        fn === pdfjsLib.OPS.paintImageMaskXObject
    );

    pageBoundaries.push({ page: i + 1, startOffset, endOffset, hasImage, pdfPageRef: page });
  }

  return { fullText, pageBoundaries, pageFrequency, numPages, filename };
};

// 偵測疑似浮水印/噪音的候選字串，只列出供使用者確認，不自動過濾
// 排除長度太短的字串（如選項字母"A."）避免誤列入候選
Parsers.detectNoiseCandidates = function (pageFrequency, numPages) {
  const threshold = Math.max(3, Math.ceil(numPages * 0.3));
  return Object.entries(pageFrequency)
    .filter(([str, count]) => str.length >= 6 && count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([text, count]) => ({ text, count, ratio: count / numPages }));
};

// 從fullText裡寮除使用者勾選要濾掉的字串
Parsers.removeNoiseStrings = function (text, noiseStrings) {
  let result = text;
  (noiseStrings || []).forEach((s) => {
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), " ");
  });
  return result;
};

Parsers.renderPageImage = async function (page, scale) {
  scale = scale || 1.5;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
};

Parsers.extractRawText = async function (file, ext) {
  if (ext === "pdf") {
    const arrayBuffer = await file.arrayBuffer();
    return await Parsers.extractPDFText(arrayBuffer, file.name);
  }
  if (ext === "rtf") {
    const raw = await file.text();
    const { plainText } = Parsers.stripRTF(raw);
    return { fullText: plainText, pageBoundaries: [], pageFrequency: {}, numPages: 0, filename: file.name };
  }
  const text = await file.text();
  return { fullText: text, pageBoundaries: [], pageFrequency: {}, numPages: 0, filename: file.name };
};

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

Parsers.parseExcel = async function (arrayBuffer, filename) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];

  const imageMap = {};
  sheet.getImages().forEach((img) => {
    const media = workbook.model.media.find((m) => m.index === img.imageId);
    const dataUri = "data:image/" + media.extension + ";base64," + media.buffer.toString("base64");
    const row = Math.round(img.range.tl.row);
    imageMap[row] = dataUri;
  });

  const questions = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (col) => row.getCell(col).text || "";
    const options = [];
    for (let i = 1; i <= 10; i++) {
      const val = get("option" + i);
      if (val) options.push(val);
    }
    const answers = get("answer")
      .split(/[;,]/)
      .filter(Boolean)
      .map((n) => parseInt(n, 10));
    questions.push({
      id: "xlsx_row" + rowNumber,
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
