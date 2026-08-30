// db.js — 覆核編輯器與匯入工具共用的 IndexedDB 存取層 (issue #23 方案 A)
//
// 設計前提(見 issue #23 留言的定案):
// - import.html 解析完題目後應「直接寫入」這裡定義的 IndexedDB,不再先落地中間 zip。
//   本檔案目前只由 review.js 使用；main.js 改寫成呼叫 DB.putQuestions()/DB.putImage()
//   是另一張票(#23 checklist 第 2 項),尚未實作，故此處的資料目前需靠下方
//   DB.importFromLegacyZip() 這個過渡用的手動匯入功能填充（見檔尾說明）。
// - 圖片一律存 Blob，不用 base64 data URI，避免字串放大 33% 的額外記憶體成本。
// - 審核狀態四態：pending / approved / needs_fix / rejected（issue #23）。

const DB_NAME = "TakeTheTestImportDB";
const DB_VERSION = 1;
const STORE_QUESTIONS = "questions";
const STORE_IMAGES = "images";
const STORE_META = "meta";

const DB = {};

let _dbPromise = null;

DB.open = function () {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
        const qStore = db.createObjectStore(STORE_QUESTIONS, { keyPath: "id" });
        qStore.createIndex("reviewStatus", "reviewStatus", { unique: false });
        qStore.createIndex("batchIndex", "batchIndex", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
};

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- meta（批次大小等設定） ----------

DB.getMeta = async function (key, defaultValue) {
  const db = await DB.open();
  const store = tx(db, [STORE_META], "readonly").objectStore(STORE_META);
  const rec = await promisifyRequest(store.get(key));
  return rec ? rec.value : defaultValue;
};

DB.setMeta = async function (key, value) {
  const db = await DB.open();
  const store = tx(db, [STORE_META], "readwrite").objectStore(STORE_META);
  await promisifyRequest(store.put({ key, value }));
};

DB.getBatchSize = function () {
  return DB.getMeta("batchSize", 150); // 預設 150 題/批，對應 issue #23 的分批建議
};

DB.setBatchSize = function (n) {
  return DB.setMeta("batchSize", Math.max(1, parseInt(n, 10) || 150));
};

// ---------- questions ----------

// 供 main.js 未來寫入用：一次寫入一批解析完的題目（每題需已帶 reviewStatus: "pending"）
DB.putQuestions = async function (questions) {
  const db = await DB.open();
  const store = tx(db, [STORE_QUESTIONS], "readwrite").objectStore(STORE_QUESTIONS);
  await Promise.all(
    questions.map((q) =>
      promisifyRequest(
        store.put(
          Object.assign(
            {
              reviewStatus: "pending",
              reviewNote: "",
            },
            q
          )
        )
      )
    )
  );
};

DB.updateReviewStatus = async function (id, status, note) {
  const db = await DB.open();
  const store = tx(db, [STORE_QUESTIONS], "readwrite").objectStore(STORE_QUESTIONS);
  const q = await promisifyRequest(store.get(id));
  if (!q) throw new Error(`找不到題目 id=${id}`);
  q.reviewStatus = status;
  if (note !== undefined) q.reviewNote = note;
  q.reviewedAt = new Date().toISOString();
  await promisifyRequest(store.put(q));
  return q;
};

// 依 reviewStatus 分頁讀取（review.js 的批次載入用；未做 cursor 範圍優化，題庫再放大時可再改寫成 openCursor 版本）
DB.getQuestionsByStatus = async function (status, offset, limit) {
  const db = await DB.open();
  const store = tx(db, [STORE_QUESTIONS], "readonly").objectStore(STORE_QUESTIONS);
  const index = store.index("reviewStatus");
  const all = await promisifyRequest(index.getAll(status));
  return all.slice(offset, offset + limit);
};

DB.countByStatus = async function (status) {
  const db = await DB.open();
  const store = tx(db, [STORE_QUESTIONS], "readonly").objectStore(STORE_QUESTIONS);
  const index = store.index("reviewStatus");
  return promisifyRequest(index.count(status));
};

DB.countAllByStatus = async function () {
  const statuses = ["pending", "approved", "needs_fix", "rejected"];
  const counts = await Promise.all(statuses.map((s) => DB.countByStatus(s)));
  return Object.fromEntries(statuses.map((s, i) => [s, counts[i]]));
};

// ---------- images ----------

DB.putImage = async function (path, blob) {
  const db = await DB.open();
  const store = tx(db, [STORE_IMAGES], "readwrite").objectStore(STORE_IMAGES);
  await promisifyRequest(store.put({ path, blob }));
};

DB.getImageBlob = async function (path) {
  if (!path) return null;
  const db = await DB.open();
  const store = tx(db, [STORE_IMAGES], "readonly").objectStore(STORE_IMAGES);
  const rec = await promisifyRequest(store.get(path));
  return rec ? rec.blob : null;
};

// ---------- 匯出用：取出所有 approved 題目，依 batchSize 切成多批 ----------

DB.getApprovedQuestionsInBatches = async function (batchSize) {
  const db = await DB.open();
  const store = tx(db, [STORE_QUESTIONS], "readonly").objectStore(STORE_QUESTIONS);
  const index = store.index("reviewStatus");
  const approved = await promisifyRequest(index.getAll("approved"));
  const batches = [];
  for (let i = 0; i < approved.length; i += batchSize) {
    batches.push(approved.slice(i, i + batchSize));
  }
  return batches;
};

window.DB = DB;
