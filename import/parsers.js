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

// \pict 目的地群組的格式控制字对照表
Parsers.PICT_FORMAT_MAP = {
  pngblip: "png",
  jpegblip: "jpg",
  emfblip: "emf",
  wmetafile: "wmf",
  macpict: "pict",
  dibitmap: "bmp",
  wbitmap: "bmp",
};

Parsers.detectPictFormat = function (pictGroupText) {
  const keys = Object.keys(Parsers.PICT_FORMAT_MAP);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (pictGroupText.indexOf("\\" + key) !== -1) {
      return {
        control: key,
        ext: Parsers.PICT_FORMAT_MAP[key],
        isVector: key === "emfblip" || key === "wmetafile" || key === "macpict",
        needsBmpHeader: key === "dibitmap" || key === "wbitmap",
      };
    }
  }
  return { control: null, ext: "bin", isVector: false, needsBmpHeader: false };
};

Parsers.hexToBytes = function (hexString) {
  const clean = hexString.replace(/[^0-9a-fA-F]/g, "");
  const byteCount = clean.length >> 1;
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
};

Parsers.bytesToBase64 = function (bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

// 保留舊 API 相容(仍可直接 hex→base64，不經過 BMP 补頭)
Parsers.hexToBase64 = function (hexString) {
  return Parsers.bytesToBase64(Parsers.hexToBytes(hexString));
};

// \dibitmap/\wbitmap 控制字的資料是 DIB(Device Independent Bitmap)，只有 BMP 檔本體，欠一個 14 bytes 的 BMP 檔案頭，
// 需自行補上檔頭才能當成完整 .bmp 顯示。根據 BITMAPINFOHEADER(前40bytes)的 biBitCount/biClrUsed 推導調色盤大小以計算像素資料偏移。
Parsers.dibToBmp = function (dibBytes) {
  const headerSize = dibBytes[0] | (dibBytes[1] << 8) | (dibBytes[2] << 16) | (dibBytes[3] << 24);
  const bitCount = dibBytes[14] | (dibBytes[15] << 8);
  let biClrUsed = dibBytes[32] | (dibBytes[33] << 8) | (dibBytes[34] << 16) | (dibBytes[35] << 24);
  let paletteEntries = biClrUsed;
  if (!paletteEntries && bitCount > 0 && bitCount <= 8) {
    paletteEntries = 1 << bitCount;
  }
  const paletteSize = (paletteEntries || 0) * 4;
  const pixelDataOffset = 14 + headerSize + paletteSize;
  const fileSize = 14 + dibBytes.length;

  const bmp = new Uint8Array(fileSize);
  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  bmp[2] = fileSize & 0xff;
  bmp[3] = (fileSize >> 8) & 0xff;
  bmp[4] = (fileSize >> 16) & 0xff;
  bmp[5] = (fileSize >> 24) & 0xff;
  bmp[6] = 0;
  bmp[7] = 0;
  bmp[8] = 0;
  bmp[9] = 0;
  bmp[10] = pixelDataOffset & 0xff;
  bmp[11] = (pixelDataOffset >> 8) & 0xff;
  bmp[12] = (pixelDataOffset >> 16) & 0xff;
  bmp[13] = (pixelDataOffset >> 24) & 0xff;
  bmp.set(dibBytes, 14);
  return bmp;
};

// 以括弧深度扫描找出完整的 {\pict...} 目的地群組，不依賴現有 /\{\\pict[\s\S]*?\}\}/ 這種假設固定兩層 } 的 regex，
// 因為實际 RTF 匯出工具包裝 \pict 的層數不一定，固定假設會漏抓圖。
Parsers.findPictGroups = function (rtfRaw) {
  const groups = [];
  const marker = "{\\pict";
  let searchFrom = 0;
  while (true) {
    const start = rtfRaw.indexOf(marker, searchFrom);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    let i = start;
    for (; i < rtfRaw.length; i++) {
      const ch = rtfRaw[i];
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) break;
    groups.push({ start, end, text: rtfRaw.slice(start, end) });
    searchFrom = end;
  }
  return groups;
};

// 擷取圖片資料並換成帶編號的 placeholder。這個 placeholder 會跟著文字一起流過
// 後面的 block 切分與欄位判斷(rtf-conventions.js)，不需要額外維護「圖片在原始 RTF 位置」這一套独立坐標系。
Parsers.extractPictImages = function (rtfRaw) {
  const images = [];
  const groups = Parsers.findPictGroups(rtfRaw);
  if (groups.length === 0) {
    return { images, textWithPlaceholders: rtfRaw };
  }
  let result = "";
  let cursor = 0;
  groups.forEach((group) => {
    result += rtfRaw.slice(cursor, group.start);
    const index = images.length;
    const format = Parsers.detectPictFormat(group.text);
    const hexPayload = group.text
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
      .replace(/[{}]/g, "")
      .trim();
    let base64 = "";
    const ext = format.ext;
    try {
      const rawBytes = Parsers.hexToBytes(hexPayload);
      if (format.needsBmpHeader) {
        base64 = Parsers.bytesToBase64(Parsers.dibToBmp(rawBytes));
      } else {
        base64 = Parsers.bytesToBase64(rawBytes);
      }
    } catch (e) {
      console.warn("pict image decode failed for image " + index, e);
    }
    images.push({ index, format: format.control, ext, isVector: format.isVector, base64 });
    result += "[IMAGE:" + index + "]";
    cursor = group.end;
  });
  result += rtfRaw.slice(cursor);
  return { images, textWithPlaceholders: result };
};

Parsers.stripRTF = function (rtfRaw) {
  const { images, textWithPlaceholders } = Parsers.extractPictImages(rtfRaw);
  const pictBlocks = images.length; // 維持原本 pictBlocks 的語意(圖片數量)
  const plainText = textWithPlaceholders
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\\'0[da]/gi, "\n")
    .replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "");
  return { plainText, pictBlocks, images };
};

// 只自動過濵hex指紋碼，其他重複文字都保留在fullText裡，區間掛頁频率統計回傳給main.js讓使用者確認是否要手動濯掉
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

// 偵測疑似浮水印/噪音的候選字串，只列出供使用者確認，不自動過濵
// 排除長度太短的字串（如選項字母"A."）避免誤列入候選
Parsers.detectNoiseCandidates = function (pageFrequency, numPages) {
  const threshold = Math.max(3, Math.ceil(numPages * 0.3));
  return Object.entries(pageFrequency)
    .filter(([str, count]) => str.length >= 6 && count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([text, count]) => ({ text, count, ratio: count / numPages }));
};

// 從fullText裡剔除使用者勾選要濯掉的字串
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
    const { plainText, images } = Parsers.stripRTF(raw);
    return { fullText: plainText, pageBoundaries: [], pageFrequency: {}, numPages: 0, filename: file.name, images };
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
