// version.js
// Displays the import tool's version at the bottom of the page so testers can tell
// whether a broken result is a stale deployment (old version cached) or a genuinely
// broken new version.
//
// Versioning: MAJOR.MINOR.PATCH
// - PATCH: bug fixes (e.g. the missing 題號 fix #14, the question-text-collapse fix #16)
// - MINOR: new features / behavior changes (e.g. RTF convention support, rtf.js-based
//   extraction)
// - MAJOR: breaking changes to existing data/behavior
// Bump this string in every commit that changes import/*.js.
const IMPORT_TOOL_VERSION = "1.1.2";

(function () {
  const footer = document.createElement("div");
  footer.id = "importToolVersion";
  footer.textContent = "\u5efa\u5165\u5de5\u5177\u7248\u672c\uff1a v" + IMPORT_TOOL_VERSION;
  footer.style.position = "fixed";
  footer.style.bottom = "0";
  footer.style.right = "0";
  footer.style.padding = "4px 10px";
  footer.style.fontSize = "12px";
  footer.style.color = "#888";
  footer.style.background = "rgba(255,255,255,0.85)";
  footer.style.borderTop = "1px solid #ddd";
  footer.style.borderLeft = "1px solid #ddd";
  footer.style.zIndex = "9999";
  footer.style.fontFamily = "monospace";
  document.body.appendChild(footer);
})();

window.IMPORT_TOOL_VERSION = IMPORT_TOOL_VERSION;
