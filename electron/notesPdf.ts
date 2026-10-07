import { app, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

const EXPORT_TITLE = '阅读笔记';
const MAX_NOTES = 100_000;
const ALLOWED_COLORS = new Set(['#fcd34d', '#86efac', '#fca5a5']);

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') throw new Error('无效的笔记数据');
  const value = payload as { title?: unknown; notes?: unknown };
  if (!Array.isArray(value.notes) || value.notes.length > MAX_NOTES) throw new Error('笔记数量超出限制');

  return {
    title: typeof value.title === 'string' ? value.title.slice(0, 200) : EXPORT_TITLE,
    notes: value.notes.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('无效的笔记项');
      const note = item as Record<string, unknown>;
      const text = typeof note.text === 'string' ? note.text : '';
      const comment = typeof note.note === 'string' ? note.note : '';
      const createdAt = typeof note.createdAt === 'number' && Number.isFinite(note.createdAt) ? note.createdAt : Date.now();
      const color = typeof note.color === 'string' && ALLOWED_COLORS.has(note.color) ? note.color : '#fcd34d';
      return { text: text.slice(0, 100_000), note: comment.slice(0, 100_000), createdAt, color };
    }),
  };
}

export async function exportNotesPdf(rawPayload: unknown) {
  const payload = normalizePayload(rawPayload);
  const defaultPath = path.join(app.getPath('documents'), `notes-${Date.now()}.pdf`);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出笔记 PDF',
    defaultPath,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, cancelled: true };

  const pdfWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#f8f3ee',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  const title = escapeHtml(payload.title || EXPORT_TITLE);
  const notesHtml = payload.notes.map((note) => `
    <article class="note-card">
      <div class="note-accent" style="background:${note.color}"></div>
      <section class="note-body">
        <blockquote>${escapeHtml(note.text)}</blockquote>
        ${note.note ? `<p class="note-comment">${escapeHtml(note.note)}</p>` : ''}
        <time>${escapeHtml(new Date(note.createdAt).toLocaleString('zh-CN'))}</time>
      </section>
    </article>`).join('');

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><title>${title}</title>
    <style>
      @page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#2f2924;background:#f8f3ee}
      h1{margin:0 0 16px;font-size:24px;letter-spacing:.08em}.meta{margin-bottom:24px;color:#7d736a;font-size:12px}.notes{display:flex;flex-direction:column;gap:16px}
      .note-card{display:flex;gap:12px;padding:16px 18px;border-radius:18px;background:rgba(255,255,255,.76);border:1px solid rgba(47,41,36,.08);break-inside:avoid;box-shadow:0 12px 32px rgba(47,41,36,.08)}
      .note-accent{width:6px;border-radius:999px;align-self:stretch}.note-body{flex:1;min-width:0}blockquote{margin:0;font-family:"Noto Serif SC","Songti SC",serif;font-size:15px;line-height:1.85;white-space:pre-wrap}
      .note-comment{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:rgba(47,41,36,.05);font-size:13px;line-height:1.75;white-space:pre-wrap}time{display:block;margin-top:10px;font-size:11px;color:#8b8177}
    </style></head><body><h1>${title}</h1><div class="meta">共 ${payload.notes.length} 条笔记</div><section class="notes">${notesHtml}</section></body></html>`;

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await pdfWindow.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true');
    const pdfData = await pdfWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(filePath, pdfData);
    return { ok: true, filePath };
  } finally {
    pdfWindow.destroy();
  }
}
