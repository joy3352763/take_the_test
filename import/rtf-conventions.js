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

// 32-char hex fingerprint noise line (same format as the PDF watermark), checked at
// whole-line granularity since RTF/TXT sources are plain lines, not pdf.js text items.
function isHexFingerprintLine(line) {
  return /^[0-9A-F]{32}$/i.test(line.trim());
}
RTFConventions.isHexFingerprintLine = isHexFingerprintLine;

// Fixes the cross-format bug where only lines[0] was used as the question text, silently
// dropping any question content that comes after an image or spans multiple lines.
// Collects every line up to (not including) the first option line, skipping hex-fingerprint
// noise and convention-defined metadata lines, and extracting the image placeholder (if any)
// as a hasImage flag instead of leaving the literal placeholder text in the question.
RTFConventions.assembleQuestionText = function (lines, convention) {
  const questionParts = [];
  let hasImage = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (convention.optionLinePattern.test(line)) break;
    if (isHexFingerprintLine(line)) continue;
    if (convention.skipLinePatterns.some((p) => p.test(line))) continue;

    if (convention.imagePlaceholderToken && line.includes(convention.imagePlaceholderToken)) {
      hasImage = true;
      const cleaned = line.split(convention.imagePlaceholderToken).join(" ").trim();
      if (cleaned) questionParts.push(cleaned);
      continue;
    }
    questionParts.push(line);
  }

  return { text: questionParts.join(" ").trim(), hasImage };
};

// Same shape/behavior as parsers.js's findAnswerLetters, but captures the explanation text
// itself (everything after the label, plus any following lines) instead of a letter code.
RTFConventions.findExplanation = function (bodyLines, escapedLabels) {
  if (!escapedLabels || !escapedLabels.length) return "";
  const labelRegex = new RegExp("^(?:" + escapedLabels.join("|") + ")\\s*[:\uff1a]?\\s*(.*)$", "i");

  for (let i = 0; i < bodyLines.length; i++) {
    const m = bodyLines[i].match(labelRegex);
    if (!m) continue;
    const collected = [(m[1] || "").trim()];
    for (let j = i + 1; j < bodyLines.length; j++) {
      const next = bodyLines[j].trim();
      if (!next) continue;
      collected.push(next);
    }
    return collected.filter(Boolean).join(" ").trim();
  }
  return "";
};

// Mirrors Parsers.detectAnswerLabelCandidates so the Step 2 UI can offer the same
// checkbox-based candidate-selection UX for explanation labels.
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

// New parse function (does not replace Parsers.parseBlockToQuestion). Reuses the same
// letter-to-0-based-index convention already validated for the PDF pipeline.
Parsers.parseBlockToQuestionV2 = function (blockText, filename, idx, answerLabels, explanationLabels, convention, delimiterRegex) {
  convention = convention || RTFConventions.PDF_DEFAULT_CONVENTION;
  const labels = answerLabels && answerLabels.length ? answerLabels : convention.answerLabels;
  const explLabels = explanationLabels && explanationLabels.length ? explanationLabels : convention.explanationLabels;

  // Derive the delimiter-prefix to strip from whichever delimiter regex the user selected
  // in Step 2, instead of hardcoding a per-convention prefix pattern.
  if (delimiterRegex) {
    const flatFlags = delimiterRegex.flags.replace(/g/g, "");
    const startRe = new RegExp(delimiterRegex.source, flatFlags);
    const m = blockText.match(startRe);
    if (m && m.index === 0) {
      blockText = blockText.slice(m[0].length).trim();
    }
  }

  const lines = blockText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const { text: question, hasImage } = RTFConventions.assembleQuestionText(lines, convention);

  const optionLines = lines.filter((l) => convention.optionLinePattern.test(l));
  const options = optionLines.map((l) => l.replace(convention.optionPrefixPattern, "").trim());

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
  const explanation = RTFConventions.findExplanation(lines, escapedExplLabels);

  const needsReview =
    options.length === 0 ||
    answers.length === 0 ||
    (hasImage && convention.imagePlaceholderForcesReview);

  return {
    id: filename.replace(/\W+/g, "_") + "_" + idx,
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
  };
};

// Adds the bare "Q3"/"Q4" style delimiter candidate without editing parsers.js's
// detectDelimiterCandidates directly.
(function () {
  const originalDetect = Parsers.detectDelimiterCandidates;
  Parsers.detectDelimiterCandidates = function (text) {
    const base = originalDetect(text);
    const extra = { key: "q_short", label: "Q number (short form, e.g. Q3)", regex: /^Q\d+\s*$/gm };
    extra.count = (text.match(extra.regex) || []).length;
    return [extra, ...base];
  };
})();
