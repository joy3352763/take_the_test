// core.js — schema驗證、圖片大小分流、JSON/ZIP匯出

const Core = {};

const BASE64_SIZE_THRESHOLD = 15 * 1024; // 15KB 原始圖片門檸，超過則改存zip資產包

// ---------- Schema 驗證 ----------
Core.validate = function (question) {
  const errors = [];
  if (!question.question) errors.push("缺少題目文字");
  if (question.options.length < 1 || question.options.length > 10) {
    errors.push(`選項數量異常: ${question.options.length}`);
  }
  if (question.type === "single" && question.answers.length !== 1) {
    errors.push("單選題必須恰好1個答案");
  }
  if (question.type === "multiple" && question.answers.length < 1) {
    errors.push("多選題至少需要11個答案");
  }
  question.answers.forEach((a) => {
    if (a < 0 || a >= question.options.length) {
      errors.push(`答案index ${a} 超出選項範圍`);
    }
  });
  return errors;
};

// ---------- 圖片大小分流 ----------
// dataUri: "data:image/png;base64,...."
// 回傳: { value, isAsset } isAsset=true時value是assets路徑，並已放入assetBag
Core.routeImage = function (dataUri, questionId, slot, assetBag) {
  if (!dataUri) return null;
  const match = dataUri.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!match) return dataUri; // 已經是路徑字串，直接沿用
  const [, mime, base64] = match;
  const approxBytes = (base64.length * 3) / 4;

  if (approxBytes <= BASE64_SIZE_THRESHOLD) {
    return dataUri; // 小圖：保留inline base64
  }
  const ext = mime.split("/")[1];
  const path = `assets/${questionId}_${slot}.${ext}`;
  assetBag[path] = base64; // 交給main.js用JSZip打包
  return path;
};

// ---------- 批次處理一組題目 ----------
Core.processQuestions = function (questions) {
  const assetBag = {};
  const reviewList = [];

  const processed = questions.map((q) => {
    q.question_image = Core.routeImage(q.question_image, q.id, "q", assetBag);
    q.option_images = q.option_images.map((img, i) =>
      Core.routeImage(img, q.id, `opt${i}`, assetBag)
    );

    const errors = Core.validate(q);
    if (errors.length) {
      q.needs_review = true;
      q._errors = errors;
    }
    if (q.needs_review) reviewList.push(q);
    return q;
  });

  return { questions: processed, assetBag, reviewList };
};

// ---------- 匯出 ----------
Core.downloadJSON = function (questions, filename = "questions.json") {
  const blob = new Blob([JSON.stringify(questions, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

Core.downloadAssetsZip = async function (assetBag, filename = "assets.zip") {
  const zip = new JSZip();
  Object.entries(assetBag).forEach(([path, base64]) => {
    zip.file(path, base64, { base64: true });
  });
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
