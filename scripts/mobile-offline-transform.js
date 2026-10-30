"use strict";

// Build-time adapters only. The independently versioned web source stays intact.
// The web dropped its cloud and feedback scripts (TOOL-01); they stay listed so
// a copy that still has them cannot bring them into the package.
const EXCLUDED_ASSETS = Object.freeze([
  "js/cloud-progress.js",
  "js/feedback-config.js",
  "js/feedback.js",
  "js/mobile-warning.js",
  "js/pwa.js",
  "sw.js",
  "manifest.webmanifest",
]);
const OFFLINE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  // index.html sets <base href="/"> so assets resolve from the package root
  // after site-pages.js moves the address to a module path such as /textbook/.
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function removeElement(html, id) {
  const opening = new RegExp(
    `<([a-z][a-z0-9-]*)\\b[^>]*\\bid="${id}"[^>]*>`,
    "i",
  );
  const match = opening.exec(html);
  if (!match) throw new Error(`Missing offline transform anchor: #${id}`);
  const tag = match[1];
  const tokens = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tokens.lastIndex = match.index;
  let depth = 0;
  let token;
  while ((token = tokens.exec(html))) {
    depth += token[1] ? -1 : 1;
    if (depth === 0)
      return html.slice(0, match.index) + html.slice(tokens.lastIndex);
  }
  throw new Error(`Unclosed offline transform anchor: #${id}`);
}

const SITE_METADATA_START =
  "<!-- Generated site metadata: npm run site:generate -->";
const SITE_METADATA_END = "<!-- End site metadata -->";
// The web's about page describes the public site (hosting, outside links);
// the app opens its own offline About dialog from mobile-native.js instead.
const ABOUT_LINK = /<a id="appAboutLink"[^>]*>[\s\S]*?<\/a>/g;
const ABOUT_BUTTON =
  '<button id="appAboutLink" class="app-appearance-open" type="button" aria-haspopup="dialog">' +
  "<span>关于应用</span><small>本机记录 · 内容说明 · 联系方式</small>" +
  '<ui-icon name="chevron-right"></ui-icon></button>';

function transformIndex(html) {
  html = removeElement(html, "mobileUnsupportedNotice");
  // Search metadata names the public site (canonical URL, Open Graph, schema);
  // the app keeps only the title from that block.
  const metadataStart = html.indexOf(SITE_METADATA_START);
  const metadataEnd = html.indexOf(SITE_METADATA_END);
  if (
    metadataStart < 0 ||
    metadataEnd < metadataStart ||
    html.indexOf(SITE_METADATA_START, metadataStart + 1) >= 0
  )
    throw new Error("Missing site metadata anchors");
  html =
    html.slice(0, metadataStart) +
    "<title>词基流动</title>" +
    html.slice(metadataEnd + SITE_METADATA_END.length);
  if (html.split('<base href="/">').length !== 2)
    throw new Error("Missing package root base anchor");
  const aboutLinks = html.match(ABOUT_LINK) || [];
  if (aboutLinks.length !== 1 || !aboutLinks[0].includes("./privacy.html"))
    throw new Error("Unexpected about link anchor");
  html = html.replace(ABOUT_LINK, ABOUT_BUTTON);
  for (const asset of EXCLUDED_ASSETS.filter((asset) =>
    asset.endsWith(".js"),
  )) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(
      new RegExp(
        `<script\\s+src="\\./${escaped}(?:\\?[^"]*)?"[^>]*><\\/script>`,
        "g",
      ),
      "",
    );
  }
  html = html.replace(/<link\s+rel="manifest"[^>]*>/g, "");
  html = html.replace(
    /<a\b[^>]*\bhref="(?:https?:)?\/\/[^>]*>[\s\S]*?<\/a>/gi,
    "",
  );
  if (!html.includes('<meta charset="UTF-8">'))
    throw new Error("Missing charset anchor for offline CSP");
  html = html.replace(
    '<meta charset="UTF-8">',
    `<meta charset="UTF-8">\n    <meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`,
  );
  html = html
    .replace("下载当前完整备份", "保存当前完整备份")
    .replace("下载恢复前页面备份", "保存恢复前页面备份")
    .replace("下载恢复前本机备份", "保存恢复前本机备份");
  const archiveHint = "换浏览器或域名前，请先下载备份。";
  if (html.split(archiveHint).length !== 2)
    throw new Error("Unexpected native archive hint anchor");
  html = html.replace(
    archiveHint,
    "更换设备、卸载应用或清理应用数据前，请先保存备份。",
  );
  const filePicker =
    '<label class="archive-file">选择备份文件（JSON，最多 8 MB）<input id="archiveFile" type="file" accept=".json,application/json"></label>';
  if (html.split(filePicker).length !== 2)
    throw new Error("Unexpected native archive file picker anchor");
  html = html.replace(
    filePicker,
    '<div class="archive-file"><span id="archiveFileLabel">选择备份文件（JSON，最多 8 MB）</span>' +
      '<input id="archiveFile" type="file" accept=".json,application/json" hidden aria-hidden="true" tabindex="-1">' +
      '<button id="archiveChooseFile" type="button" aria-describedby="archiveFileLabel archiveChosenFile">选择备份文件</button>' +
      '<span id="archiveChosenFile" role="status" style="overflow-wrap:anywhere">尚未选择备份文件</span></div>',
  );
  return html;
}

function transformProgressStore(source) {
  for (const message of ["离线，待联网同步", "暂存本地，待重试"]) {
    if (source.split(message).length !== 2)
      throw new Error("Unexpected offline progress error text anchor");
    source = source.replace(message, "暂存本机，保存待重试；请保留应用数据");
  }
  return source;
}

function transformArchiveUI(source) {
  const start = source.indexOf("    var url = URL.createObjectURL(");
  const endMarker = "    }, 60000);";
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0)
    throw new Error("Missing archive download adapter anchor");
  source =
    source.slice(0, start) +
    "    await window.JPLearnMobileFiles.saveArchive(\n" +
    "      JSON.stringify(archive, null, 2),\n" +
    "      'kotobaflow-progress-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',\n" +
    "    );" +
    source.slice(end + endMarker.length);
  const fileAnchor = "var file = event.target.files[0];";
  if (!source.includes(fileAnchor))
    throw new Error("Missing archive import adapter anchor");
  source = source.replace(
    fileAnchor,
    "var file = event.detail && event.detail.nativeFile ? event.detail.nativeFile : event.target.files[0];",
  );
  const restoredControls = "['archiveClose', 'archiveFile', 'archiveMode']";
  if (!source.includes(restoredControls))
    throw new Error("Missing restored archive controls anchor");
  source = source.replace(
    restoredControls,
    "['archiveClose', 'archiveFile', 'archiveChooseFile', 'archiveMode']",
  );
  // A backup can also be handed to another app, which never reports whether
  // it kept the file; JPLearnMobileFiles words the status for either path.
  for (const [message, saved] of [
    ["备份已生成，请妥善保存下载的 JSON 文件。", "备份已保存到所选文件。"],
    ["恢复前的页面记录备份已生成。", "恢复前的页面记录备份已保存。"],
    ["恢复前的本机服务备份已生成。", "恢复前的本机记录备份已保存。"],
  ]) {
    const statement = `status.textContent = '${message}';`;
    if (source.split(statement).length !== 2)
      throw new Error(`Missing archive status anchor: ${message}`);
    source = source.replace(
      statement,
      `status.textContent = window.JPLearnMobileFiles.resultText('${saved}');`,
    );
  }
  return source.replace("恢复前备份仍可下载。", "恢复前备份仍可保存到文件。");
}

module.exports = {
  transformIndex,
  transformArchiveUI,
  transformProgressStore,
  EXCLUDED_ASSETS,
  OFFLINE_CSP,
};
