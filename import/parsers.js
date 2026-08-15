// parsers.js — 各格式的解析器，統一輸出中介格式陣列
// 中介格式: { id, question, question_image, type, options, option_images, answers, source, needs_review }

const Parsers = {};

// ---------- CSV / TXT ----------
// 假設固定欄位: question,type,option1..option10,answer(逗號分隔index)
Parsers.parseCSV = function (text, filename) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1);
  return rows.map((line, idx) => {
    const cells = line.split(","); // TODO: 換成正式的CSV parser以處理逗號內含引號的情況
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

// TXT走同一套規則式regex，格式需自行依題庫慣例調整
Parsers.parseTXT = function (text, filename) {
  const blocks = text.split(/\n\s*\n/); // 空行分題
  return blocks
    .filter((b) => b.trim())
    .map((block, idx) => {
      const lines = block.split(/\r?\n/).filter(Boolean);
      const question = lines[0] || "";
      const optionLines = lines.filter((l) => /^[A-J][.\u3001)]/.test(l.trim()));
      const options = optionLines.map((l) => l.replace(/^[A-J][.\u3001)]\s*/, ""));
      const answerLine = lines.find((l) => /^(\u7b54\u6848|Answer)[:\uff1a]/i.test(l));
      const answerLetters = answerLine ? answerLine.replace(/^(\u7b54\u6848|Answer)[:\uff1a]\s*/i, "") : "";
      const answers = answerLetters
        .split("")
        .filter((c) => /[A-J]/.test(c))
        .map((c) => c.charCodeAt(0) - "A".charCodeAt(0));
      return {
        id: `txt_${idx}`,
        question,
        question_image: null,
        type: answers.length > 1 ? "multiple" : "single",
        options,
        option_images: options.map(() => null),
        answers,
        source: { file: filename, block: idx },
        needs_review: options.length === 0 || answers.length === 0,
      };
    });
};

// ---------- RTF ----------
// 簡化版：先用striprtf風格的regex去掉控制字元拿到純文字，圖片(\pict)區塊先跳過標記needs_review
Parsers.parseRTF = function (rtfRaw, filename) {
  const pictBlocks = (rtfRaw.match(/\{\\pict[\s\S]*?\}\}/g) || []).length;
  const plainText = rtfRaw
    .replace(/\{\\pict[\s\S]*?\}\}/g, "[IMAGE]") // 圖片位置先用佔位字串標記
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "");

  const questions = Parsers.parseTXT(plainText, filename);
  if (pictBlocks > 0) {
    questions.forEach((q) => (q.needs_review = true)); // 有圖片，需人工確認對應關係
  }
  return questions;
};

// ---------- DOCX (mammoth.js) ----------
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
  // TODO: 解析result.value(HTML)，依段落/表格結構切出題目、選項、圖片
  // 這裡先回傳整份HTML讓人工確認切分規則，示意用途
  return {
    raw_html: result.value,
    messages: result.messages,
    needs_review: true,
    source: { file: filename },
  };
};

// ---------- Excel (ExcelJS) ----------
Parsers.parseExcel = async function (arrayBuffer, filename) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];

  // 建立 row -> image(base64) 的對應表，依cell anchor座標判斷
  const imageMap = {};
  sheet.getImages().forEach((img) => {
    const media = workbook.model.media.find((m) => m.index === img.imageId);
    const dataUri = `data:image/${media.extension};base64,${media.buffer.toString("base64")}`;
    const row = Math.round(img.range.tl.row); // top-left row (0-indexed)
    imageMap[row] = dataUri;
  });

  const questions = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
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
      option_images: options.map(() => null), // TODO: 依option image欄位column做同樣的anchor對應
      answers,
      source: { file: filename, row: rowNumber },
      needs_review: options.length === 0 || answers.length === 0,
    });
  });
  return questions;
};

// ---------- PDF (pdf.js) ----------
// 浮水印過濾: 依文字顏色/透明度/字型判斷，需依實際樣本調整isWatermarkSpan()
function isWatermarkSpan(item) {
  // TODO: pdf.js的getTextContent()回傳的item没有直接的顏色資訊，
  // 需搭配 page.getOperatorList() 或已知的浮水印字串清單來過濾
  const KNOWN_WATERMARK_STRINGS = ["店铺", "IT认证考试服务"]; // 依實際樣本補充
  return KNOWN_WATERMARK_STRINGS.some((s) => item.str.includes(s));
}

Parsers.parsePDF = async function (arrayBuffer, filename) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const filtered = textContent.items.filter((item) => !isWatermarkSpan(item));
    fullText += filtered.map((item) => item.str).join(" ") + "\n\n";
    // TODO: 圖片抽取需另外用page.getOperatorList()找OPS.paintImageXObject，較複雜，先略過
  }
  const questions = Parsers.parseTXT(fullText, filename);
  questions.forEach((q) => (q.needs_review = true)); // PDF來源一律先標記人工覆核
  return questions;
};
