// core.js — schema驗證、圖片路由、JSON/ZIP匯出

const Core = {};

// ---------- Schema 驗證 ----------
Core.validate = function (question) {
  const errors = [];
  if (!question.question) errors.push("缺少題目文字");
  if (question.options.length < 1 || question.options.length > 10) {
    errors.push(`選項數量異常: ${question.options.length}`);
  }
  if (question.type === "single" && question.answers.length !== 1) {
    errors.push("单選題必須恰好1個答案");
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

// ---------- 圖片路由:一律進 zip(issue #20 決定) ----------
// 原本依 15KB 門樬區分 inline base64 / zip 資產包，但規格書要的最終 CSV
// (scriptjs-export.js 輸出、真正給 index.html 吃的)裡 img_* 欄位存的是「檔名」，
// 不是 base64 —— inline 會讓 index.html 端 <img src="images/檔名"> 的契約失效。
// 所以不論圖片大小，一律寫入 assetBag，交給 main.js 用 JSZip 打包。
//
// dataUri: "data:image/png;base64,...."
// 回傳: assets 路徑字串;若 dataUri 已經是路徑字串或空值，原樣回傳
Core.routeImage = function (dataUri, questionId, slot, assetBag) {
  if (!dataUri) return null;
  const match = dataUri.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!match) return dataUri; // 已經是路徑字串，直接沿用
  const [, mime, base64] = match;
  const ext = mime.split("/")[1];
  const path = `assets/${questionId}_${slot}.${ext}`;
  assetBag[path] = base64; // 交給main.js用JSZip打包
  return path;
};

// 同一欄位可能有多張圖(例如題幹/詳解裡不只一張，見 issue #20 的 rtf-conventions.js
// stem_image_indexes/explanation_image_indexes)，逐張路由並依序編號避免檔名碰撞。
// dataUris 為 data URI 字串陣列(空值會被過濵掉)，回傳对應的 assets 路徑陣列。
Core.routeImages = function (dataUris, questionId, slot, assetBag) {
  const list = (dataUris || []).filter(Boolean);
  return list.map((dataUri, i) =>
    Core.routeImage(dataUri, questionId, list.length > 1 ? `${slot}_${i}` : slot, assetBag)
  );
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
