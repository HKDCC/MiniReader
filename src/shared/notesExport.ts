import { notesCopy } from './copy';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildNotesMarkdown(notes: Array<{ text: string; note?: string; createdAt: number }>) {
  return notes
    .map((note) => {
      const date = new Date(note.createdAt).toLocaleString('zh-CN');
      const noteBlock = note.note ? `**${notesCopy.noteLabel}**：${note.note}\n\n` : '';
      return `> ${note.text}\n\n${noteBlock}*${date}*\n---`;
    })
    .join('\n\n');
}

export function buildBrowserNotesHtml(notes: Array<{ text: string; note?: string; createdAt: number }>) {
  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>${notesCopy.exportTitle}</title>
      <style>
        body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; padding: 24px; color: #2f2924; }
        .note { margin-bottom: 16px; padding: 14px 16px; border-radius: 16px; background: #f7f1ea; }
        blockquote { margin: 0; white-space: pre-wrap; font-family: "Noto Serif SC", serif; line-height: 1.8; }
        .comment { margin-top: 10px; white-space: pre-wrap; font-size: 13px; }
        time { display: block; margin-top: 8px; color: #7d736a; font-size: 12px; }
      </style>
    </head>
    <body>
      <h1>${notesCopy.exportTitle}</h1>
      ${notes
        .map(
          (note) => `
        <article class="note">
          <blockquote>${escapeHtml(note.text)}</blockquote>
          ${note.note ? `<div class="comment">${notesCopy.noteLabel}：${escapeHtml(note.note)}</div>` : ''}
          <time>${new Date(note.createdAt).toLocaleString('zh-CN')}</time>
        </article>
      `
        )
        .join('')}
    </body>
  </html>`;
}
