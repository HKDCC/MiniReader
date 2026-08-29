"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_electron2 = require("electron");
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// electron/notesPdf.ts
var import_electron = require("electron");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));

// src/shared/copy.ts
var electronCopy = {
  exportPdfDialogTitle: "\u5BFC\u51FA\u7B14\u8BB0 PDF",
  exportTitle: "\u9605\u8BFB\u7B14\u8BB0",
  exportMetaPrefix: "\u5171 ",
  exportMetaSuffix: " \u6761\u7B14\u8BB0"
};

// electron/notesPdf.ts
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
async function exportNotesPdf(payload) {
  const defaultPath = path.join(import_electron.app.getPath("documents"), `notes-${Date.now()}.pdf`);
  const { canceled, filePath } = await import_electron.dialog.showSaveDialog({
    title: electronCopy.exportPdfDialogTitle,
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (canceled || !filePath) {
    return { ok: false, cancelled: true };
  }
  const pdfWindow = new import_electron.BrowserWindow({
    show: false,
    backgroundColor: "#f8f3ee",
    webPreferences: { sandbox: false }
  });
  const title = escapeHtml(payload.title || electronCopy.exportTitle);
  const notesHtml = payload.notes.map((note) => {
    const date = new Date(note.createdAt).toLocaleString("zh-CN");
    return `
      <article class="note-card">
        <div class="note-accent" style="background:${escapeHtml(note.color || "#fcd34d")}"></div>
        <section class="note-body">
          <blockquote>${escapeHtml(note.text || "")}</blockquote>
          ${note.note ? `<p class="note-comment">${escapeHtml(note.note)}</p>` : ""}
          <time>${escapeHtml(date)}</time>
        </section>
      </article>
    `;
  }).join("");
  const html = `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>${title}</title>
      <style>
        @page { size: A4; margin: 18mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
          color: #2f2924;
          background: #f8f3ee;
        }
        h1 { margin: 0 0 16px; font-size: 24px; letter-spacing: 0.08em; }
        .meta { margin-bottom: 24px; color: #7d736a; font-size: 12px; }
        .notes { display: flex; flex-direction: column; gap: 16px; }
        .note-card {
          display: flex;
          gap: 12px;
          padding: 16px 18px;
          border-radius: 18px;
          background: rgba(255,255,255,0.76);
          border: 1px solid rgba(47,41,36,0.08);
          break-inside: avoid;
          box-shadow: 0 12px 32px rgba(47,41,36,0.08);
        }
        .note-accent { width: 6px; border-radius: 999px; align-self: stretch; }
        .note-body { flex: 1; min-width: 0; }
        blockquote {
          margin: 0;
          font-family: "Noto Serif SC", "Songti SC", "STSong", serif;
          font-size: 15px;
          line-height: 1.85;
          white-space: pre-wrap;
        }
        .note-comment {
          margin: 12px 0 0;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(47,41,36,0.05);
          font-size: 13px;
          line-height: 1.75;
          white-space: pre-wrap;
        }
        time { display: block; margin-top: 10px; font-size: 11px; color: #8b8177; letter-spacing: 0.04em; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <div class="meta">${electronCopy.exportMetaPrefix}${payload.notes.length}${electronCopy.exportMetaSuffix}</div>
      <section class="notes">${notesHtml}</section>
    </body>
  </html>`;
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await pdfWindow.webContents.executeJavaScript("document.fonts ? document.fonts.ready.then(() => true) : true");
    const pdfData = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      marginsType: 1
    });
    fs.writeFileSync(filePath, pdfData);
    return { ok: true, filePath };
  } finally {
    pdfWindow.destroy();
  }
}

// electron/main.ts
var mainWindow = null;
var pendingOpenFiles = [];
var supportedExtensions = /* @__PURE__ */ new Set([".txt", ".epub", ".pdf"]);
function getIconPath() {
  return path2.join(__dirname, "..", "resources", "icon.ico");
}
function getSupportedFilePaths(argv) {
  return argv.map((value) => path2.resolve(value)).filter((value) => supportedExtensions.has(path2.extname(value).toLowerCase()) && fs2.existsSync(value));
}
function sendOpenFiles(filePaths) {
  if (filePaths.length === 0) return;
  pendingOpenFiles = [...pendingOpenFiles, ...filePaths];
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    return;
  }
  mainWindow.webContents.send("files:opened");
}
var gotSingleInstanceLock = import_electron2.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  import_electron2.app.quit();
}
function createMainWindow() {
  mainWindow = new import_electron2.BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 780,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#F5F0EB",
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path2.join(__dirname, "preload.js")
    }
  });
  if (!process.env.NODE_ENV || process.env.NODE_ENV === "production") {
    mainWindow.loadFile(path2.join(__dirname, "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://localhost:3000");
  }
  mainWindow.webContents.once("did-finish-load", () => {
    if (pendingOpenFiles.length > 0) {
      mainWindow?.webContents.send("files:opened");
    }
  });
}
function setupIpcHandlers() {
  import_electron2.ipcMain.handle("notes:export-pdf", async (_event, payload) => {
    try {
      return await exportNotesPdf(payload);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  import_electron2.ipcMain.on("window:minimize", () => mainWindow?.minimize());
  import_electron2.ipcMain.on("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  import_electron2.ipcMain.on("window:close", () => mainWindow?.close());
  import_electron2.ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);
  import_electron2.ipcMain.handle("files:read", async (_event, filePaths) => {
    const files = await Promise.all(
      filePaths.filter((filePath) => supportedExtensions.has(path2.extname(filePath).toLowerCase())).map(async (filePath) => {
        const data = await fs2.promises.readFile(filePath);
        return {
          name: path2.basename(filePath),
          path: filePath,
          data
        };
      })
    );
    return files;
  });
  import_electron2.ipcMain.handle("files:consume-opened", () => {
    const filePaths = Array.from(new Set(pendingOpenFiles));
    pendingOpenFiles = [];
    return filePaths;
  });
}
import_electron2.app.whenReady().then(() => {
  import_electron2.app.setAppUserModelId("com.quaxstudio.minireader");
  pendingOpenFiles = getSupportedFilePaths(process.argv.slice(1));
  createMainWindow();
  setupIpcHandlers();
  import_electron2.app.on("activate", () => {
    if (import_electron2.BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
import_electron2.app.on("second-instance", (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  sendOpenFiles(getSupportedFilePaths(argv.slice(1)));
});
import_electron2.app.on("open-file", (event, filePath) => {
  event.preventDefault();
  sendOpenFiles(getSupportedFilePaths([filePath]));
});
import_electron2.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron2.app.quit();
  }
});
