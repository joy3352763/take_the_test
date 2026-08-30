// rtf-conventions.js
// Adds convention-config-driven block parsing (issue #12) without modifying parsers.js,
// so the already-validated PDF/QUESTION-N pipeline is not touched.
//
// Design: instead of a new Parsers.parseRTFBlock or a `format` branch inside
// parseBlockToQuestion, we pass a small "convention" object describing the exporter's
// layout quirks into a new function, parseBlockToQuestionV2. The delimiter itself stays
// external (whatever regex the user already picked in Step 2); the prefix to strip is
// derived from that same regex rather than duplicated as a separate config field.

const RTFConventions = {};
// IMPORTANT (issue #16 root cause): a top-level `const`/`let` declaration in a classic
// <script> does NOT become a property of `window` (unlike `var`). main.js's
// getSelectedConvention() checks `window.RTFConventions` to decide whether to use the
// new parseBlockToQuestionV2 pipeline -- without this explicit assignment, that check
// was always false, so main.js was silently falling back to the old parseBlockToQuestion
// (and the explanation-label checkbox UI never rendered either) no matter what fixes
// were made to the V2 logic itself, since V2 was never actually being called.
window.RTFConventions = RTFConventions;

RTFConventions.PDF_DEFAULT_CONVENTION = {
  optionLinePattern: /^[A-J]\s*[.\u3001)]/,
  optionPrefixPattern: /^[A-J]\s*[.\u3001)]\s*/,
  imagePlaceholderToken: "[IMAGE]",
  imagePlaceholderForcesReview: true,
  answerLabels: ["Correct Answer", "Answer", "\u7b54\u6848"],
  explanationLabels: ["\u89e3\u6790", "\u8a73\u89e3", "Explanation"],
  skipLinePatterns: [],
};

RTFConventions.EXAM_FORMATTER_RTF_CONVENTION = {
  optionLinePattern: /^[A-J]\s*[.\u3001)]/,
  optionPrefixPattern: /^[A-J]\s*[.\u3001)]\s*/,
  imagePlaceholderToken: "[IMAGE]",
  imagePlaceholderForcesReview: true,
  answerLabels: ["Answer"],
  explanationLabels: ["Explanation/Reference", "Explanation"],
  skipLinePatterns: [/^Section:/i],
};

function isHexFingerprintLine(line) {
  return /^[0-9A-F]{32}$/i.test(line.trim());
}
RTFConventions.isHexFingerprintLine = isHexFingerprintLine;

// Indexed image placeholders ("[IMAGE:0]", "[IMAGE:1]", ...) produced by
// Parsers.extractPictImages() (see parsers.js, issue #20). These survive block-splitting
// and land in whichever line they originally occupied, so field attribution (stem vs.
// option vs. explanation) falls out naturally from *where in the line-scanning process*
// a token is encountered -- no separate "image position in the original RTF" coordinate
// system is needed.
const IMAGE_TOKEN_REGEX = /\[IMAGE:(\d+)\]/g;

function extractImageIndexesFromLine(line) {
  const indexes = [];
  const re = new RegExp(IMAGE_TOKEN_REGEX.source, "g");
  let m;
  while ((m = re.exec(line)) !== null) {
    indexes.push(parseInt(m[1], 10));
  }
  return indexes;
}
RTFConventions.extractImageIndexesFromLine = extractImageIndexesFromLine;

function stripImageTokens(line) {
  return line.replace(new RegExp(IMAGE_TOKEN_REGEX.source, "g"), " ").trim();
}
RTFConventions.stripImageTokens = stripImageTokens;

RTFConventions.assembleQuestionText = function (lines, convention) {
  const questionParts = [];
  let hasImage = false;
  const imageIndexes = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (questionParts.length > 0 && convention.optionLinePattern.test(line)) break;
    if (isHexFingerprintLine(line)) continue;
    if (convention.skipLinePatterns.some((p) => p.test(line))) continue;

    const tokenIndexes = extractImageIndexesFromLine(line);
    if (tokenIndexes.length) {
      hasImage = true;
      imageIndexes.push(...tokenIndexes);
      const cleaned = stripImageTokens(line);
      if (cleaned) questionParts.push(cleaned);
      continue;
    }

    if (convention.imagePlaceholderToken && line.includes(convention.imagePlaceholderToken)) {
      hasImage = true;
      const cleaned = line.split(convention.imagePlaceholderToken).join(" ").trim();
      if (cleaned) questionParts.push(cleaned);
      continue;
    }
    questionParts.push(line);
  }

  return { text: questionParts.join(" ").trim(), hasImage, imageIndexes };
};

RTFConventions.findExplanation = function (bodyLines, escapedLabels) {
  if (!escapedLabels || !escapedLabels.length) return { text: "", imageIndexes: [] };
  const labelRegex = new RegExp("^(?:" + escapedLabels.join("|") + ")\\s*[:\uff1a]?\\s*(.*)$", "i");

  for (let i = 0; i < bodyLines.length; i++) {
    const m = bodyLines[i].match(labelRegex);
    if (!m) continue;
    const imageIndexes = [];
    const firstRest = (m[1] || "").trim();
    imageIndexes.push(...extractImageIndexesFromLine(firstRest));
    const collected = [stripImageTokens(firstRest)];
    for (let j = i + 1; j < bodyLines.length; j++) {
      const next = bodyLines[j].trim();
      if (!next) continue;
      imageIndexes.push(...extractImageIndexesFromLine(next));
      collected.push(stripImageTokens(next));
    }
    return { text: collected.filter(Boolean).join(" ").trim(), imageIndexes };
  }
  return { text: "", imageIndexes: [] };
};

RTFConventions.detectExplanationLabelCandidates = function (text) {
  const candidates = [
    { key: "expl_ref", label: "Explanation/Reference:", pattern: "Explanation/Reference" },
    { key: "expl", label: "Explanation:", pattern: "Explanation" },
    { key: "zh_expl", label: "\u89e3\u6790:", pattern: "\u89e3\u6790" },
    { key: "zh_detail", label: "\u8a73\u89e3:", pattern: "\u8a73\u89e3" },
  ];
  return candidates.map((c) => {
    const escaped = c.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped + "\\s*[:\uff1a]?", "gi");
    return { ...c, count: (text.match(re) || []).length };
  });
};

// Extracts the exact text the chosen delimiter regex matched at the start of a block
// (e.g. "Q3", "QUESTION 12") so downstream review-list UI can show a label that matches
// what's actually visible in the source file. Without this, the review list previously
// showed a synthetic 0-based array index (filename_2) that looks like "question 2" but
// is really the 3rd block / "Q3" -- confusing for anyone trying to locate the question
// in the original RTF.
RTFConventions.extractDelimiterLabel = function (blockText, delimiterRegex) {
  if (!delimiterRegex) return null;
  const flatFlags = delimiterRegex.flags.replace(/g/g, "");
  const startRe = new RegExp(delimiterRegex.source, flatFlags);
  const m = blockText.match(startRe);
  if (m && m.index === 0) {
    return m[0].trim();
  }
  return null;
};

Parsers.parseBlockToQuestionV2 = function (blockText, filename, idx, answerLabels, explanationLabels, convention, delimiterRegex) {
  convention = convention || RTFConventions.PDF_DEFAULT_CONVENTION;
  const labels = answerLabels && answerLabels.length ? answerLabels : convention.answerLabels;
  const explLabels = explanationLabels && explanationLabels.length ? explanationLabels : convention.explanationLabels;

  const delimiterLabel = RTFConventions.extractDelimiterLabel(blockText, delimiterRegex);
  if (delimiterRegex) {
    const flatFlags = delimiterRegex.flags.replace(/g/g, "");
    const startRe = new RegExp(delimiterRegex.source, flatFlags);
    const m = blockText.match(startRe);
    if (m && m.index === 0) {
      blockText = blockText.slice(m[0].length).trim();
    }
  }

  const lines = blockText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const { text: question, hasImage: stemHasImage, imageIndexes: stemImageIndexes } = RTFConventions.assembleQuestionText(lines, convention);

  const optionLines = lines.filter((l) => convention.optionLinePattern.test(l));
  const optionImageIndexes = optionLines.map((l) => extractImageIndexesFromLine(l));
  const options = optionLines.map((l) => stripImageTokens(l.replace(convention.optionPrefixPattern, "").trim()));

  const escapedAnswerLabels = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const answerRegexBody = "^(?:" + escapedAnswerLabels.join("|") + ")\\s*[:\uff1a]\\s*(.*)$";
  const answerRegex = new RegExp(answerRegexBody, "i");
  const letterRegex = /^[A-J](?:\s*,?\s*[A-J])*/i;

  let answerLetters = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(answerRegex);
    if (!m) continue;
    let rest = (m[1] || "").trim();
    let letterMatch = rest.match(letterRegex);
    if (!letterMatch && i + 1 < lines.length) {
      letterMatch = lines[i + 1].trim().match(letterRegex);
    }
    answerLetters = letterMatch ? letterMatch[0] : "";
    break;
  }
  const answers = answerLetters
    .replace(/[^A-J]/gi, "")
    .toUpperCase()
    .split("")
    .map((c) => c.charCodeAt(0) - 65);

  const escapedExplLabels = explLabels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const explResult = RTFConventions.findExplanation(lines, escapedExplLabels);
  const explanation = explResult.text;
  const explanationImageIndexes = explResult.imageIndexes;

  const hasImage = stemHasImage || optionImageIndexes.some((arr) => arr.length > 0) || explanationImageIndexes.length > 0;

  const needsReview =
    options.length === 0 ||
    answers.length === 0 ||
    (hasImage && convention.imagePlaceholderForcesReview);

  return {
    id: filename.replace(/\W+/g, "_") + "_" + idx,
    delimiter_label: delimiterLabel,
    question,
    question_image: null,
    type: answers.length > 1 ? "multiple" : "single",
    options,
    option_images: options.map(() => null),
    answers,
    explanation,
    source: { file: filename, block: idx },
    needs_review: needsReview,
    _hasImage: hasImage,
    stem_image_indexes: stemImageIndexes,
    option_image_indexes: optionImageIndexes,
    explanation_image_indexes: explanationImageIndexes,
  };
};

(function () {
  const originalDetect = Parsers.detectDelimiterCandidates;
  Parsers.detectDelimiterCandidates = function (text) {
    const base = originalDetect(text);
    const extra = { key: "q_short", label: "Q number (short form, e.g. Q3)", regex: /^Q\d+\s*$/gm };
    extra.count = (text.match(extra.regex) || []).length;
    return [extra, ...base];
  };
})();

// Exam Formatter (and possibly other exporters) uses "\line" (a soft line break) between
// a bare "Q1" delimiter and the question stem, rather than "\par". parsers.js's stripRTF
// only converts \par/\pard to a real newline; \line falls through to the generic
// control-word stripper with NO replacement, silently gluing "Q1" directly onto the next
// word with zero separator (e.g. "Q1A recent zero-day vulnerability...").  Normalize \line
// to \par before calling the original stripRTF so it gets converted to a real newline.
//
// BUG FIX (found while diagnosing a *different* gluing report -- issue #20 comment):
// the regex/replacement below previously used unescaped "\line"/"\par" as JS source text.
// "\l" and "\p" are not recognized JS escape sequences, so the engine silently drops the
// backslash: the regex became /line\b\s?/ (matching the literal substring "line"
// anywhere) and the replacement became the literal string "par ". This corrupted any
// ordinary word containing "line" as a substring -- "baseline"->"basepar",
// "guideline"->"guidepar", "online"->"onpar", "timeline"->"timepar" -- which is exactly
// the kind of vocabulary that shows up constantly in security exam content. Properly
// escaping both sides fixes this without changing the intended \line-to-\par behavior.
(function () {
  const originalStripRTF = Parsers.stripRTF;
  Parsers.stripRTF = function (rtfRaw) {
    const normalized = rtfRaw.replace(/\\line\b\s?/g, "\\par ");
    return originalStripRTF(normalized);
  };
})();

// ================= rtf.js-based extraction: DISABLED for image-bearing RTF =================
// Historically this block replaced the "reconstruct line breaks from raw RTF control
// words via regex" role that stripRTF played, with a real spec-compliant parser (rtf.js).
//
// UPDATE (issue #20): \pict image extraction requires Parsers.stripRTF's raw-text
// scanning (Parsers.extractPictImages). The rtf.js DOM-rendering path below discards
// embedded images entirely -- verified empirically against a real image-bearing RTF
// sample (CS0-003 dump, \dibitmap0 pictures): rtf.js rendered 10008 paragraphs with
// ZERO <img>/<svg>/<canvas> nodes. Routing RTF files through rtf.js therefore silently
// drops every image, with no error and no fallback trigger (rtf.js loads and "succeeds"
// fine -- it just never surfaces the pictures).
//
// Rather than removing this code (rtf.js may still be useful for future non-image text
// reflow edge cases), Parsers.extractRawText is now left un-overridden for "rtf": every
// RTF file goes through the regex-based fallback path (with the \line fix above), which
// is the only path wired up to image extraction. The rtf.js loading/rendering functions
// remain defined below (unused) in case a future issue revisits this trade-off.

const RTFJS_CDN_BASE = "https://unpkg.com/rtf.js@3.0.7/dist/";

let rtfLibrariesReadyPromise = null;
function loadRTFLibraries() {
  if (rtfLibrariesReadyPromise) return rtfLibrariesReadyPromise;
  rtfLibrariesReadyPromise = new Promise((resolve) => {
    if (window.RTFJS) {
      resolve(true);
      return;
    }
    const files = ["WMFJS.bundle.js", "EMFJS.bundle.js", "RTFJS.bundle.js"];
    let remaining = files.length;
    let failed = false;
    files.forEach((name) => {
      const s = document.createElement("script");
      s.src = RTFJS_CDN_BASE + name;
      s.async = false;
      s.onload = () => {
        remaining--;
        if (remaining === 0) resolve(!failed);
      };
      s.onerror = () => {
        failed = true;
        remaining--;
        if (remaining === 0) resolve(false);
      };
      document.body.appendChild(s);
    });
  });
  return rtfLibrariesReadyPromise;
}
RTFConventions.loadRTFLibraries = loadRTFLibraries;

RTFConventions.rtfBufferToPlainText = async function (arrayBuffer) {
  try {
    if (window.RTFJS && RTFJS.loggingEnabled) RTFJS.loggingEnabled(false);
    if (window.WMFJS && WMFJS.loggingEnabled) WMFJS.loggingEnabled(false);
    if (window.EMFJS && EMFJS.loggingEnabled) EMFJS.loggingEnabled(false);
  } catch (e) {
    // logging toggle is non-essential; ignore failures
  }

  const doc = new RTFJS.Document(arrayBuffer);
  const htmlElements = await doc.render();

  const paragraphLines = htmlElements.map((el) => {
    const html = el.innerHTML !== undefined ? el.innerHTML : el.outerHTML || "";
    const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
    const tmp = document.createElement("div");
    tmp.innerHTML = withBreaks;
    return tmp.textContent || "";
  });

  return paragraphLines.join("\n");
};
