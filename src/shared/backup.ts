import { db, BookContent } from '../db/db';
import { hashContent } from '../utils/contentHash';

type SerializedContent =
  | {
      id: string;
      kind: 'text';
      data: string;
    }
  | {
      id: string;
      kind: 'binary';
      data: string;
    };

async function arrayBufferToBase64(buffer: ArrayBuffer) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([buffer]));
  });
}

function base64ToArrayBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function getReaderSettings() {
  return Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('mr_')));
}

async function serializeContent(content: BookContent): Promise<SerializedContent> {
  if (typeof content.data === 'string') {
    return { id: content.id, kind: 'text', data: content.data };
  }

  return { id: content.id, kind: 'binary', data: await arrayBufferToBase64(content.data) };
}

function deserializeContent(content: SerializedContent): BookContent {
  return {
    id: content.id,
    data: content.kind === 'text' ? content.data : base64ToArrayBuffer(content.data),
  };
}

export async function exportLibraryBackup() {
  const [books, contents, notes] = await Promise.all([db.books.toArray(), db.contents.toArray(), db.notes.toArray()]);
  const payload = {
    app: 'Mini Reader',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: getReaderSettings(),
    books,
    contents: await Promise.all(contents.map(serializeContent)),
    notes,
  };

  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `mini-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
}

export async function importLibraryBackup(file: File) {
  if (file.size > 512 * 1024 * 1024) throw new Error('备份文件过大');
  let payload: any;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (payload?.app !== 'Mini Reader' || payload?.schemaVersion !== 1) {
    throw new Error('不是有效的 Mini Reader 备份文件');
  }
  if (!Array.isArray(payload.books) || !Array.isArray(payload.contents) || !Array.isArray(payload.notes)) {
    throw new Error('备份文件缺少必要数据');
  }
  if (payload.books.length > 100_000 || payload.contents.length > 100_000 || payload.notes.length > 100_000) {
    throw new Error('备份数据量超出限制');
  }
  if (payload.settings !== undefined && (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings))) {
    throw new Error('备份设置格式无效');
  }
  const settingsEntries = payload.settings ? Object.entries(payload.settings) : [];
  if (settingsEntries.length > 100 || settingsEntries.some(([key, value]) => key.length > 100 || typeof value !== 'string' || value.length > 10_000)) {
    throw new Error('备份设置格式无效');
  }

  const restoredContents = payload.contents.map((content: SerializedContent) => {
    if (!content || typeof content.id !== 'string' || (content.kind !== 'text' && content.kind !== 'binary') || typeof content.data !== 'string') {
      throw new Error('备份内容格式无效');
    }
    return deserializeContent(content);
  });
  const restoredContentById = new Map<string, BookContent>(
    restoredContents.map((content): [string, BookContent] => [content.id, content])
  );
  const restoredBooks = await Promise.all(
    payload.books.map(async (book: any) => {
      if (!book || typeof book.id !== 'string' || !['txt', 'epub', 'pdf'].includes(book.format)) {
        throw new Error('备份书籍格式无效');
      }
      if (book.contentHash) return book;

      const content = restoredContentById.get(book.id);
      if (!content) return book;

      return { ...book, contentHash: await hashContent(content.data) };
    })
  );
  const restoredBookIds = new Set(restoredBooks.map((book: any) => book.id));
  const restoredNotes = payload.notes.map((note: any) => {
    if (
      !note ||
      typeof note.bookId !== 'string' ||
      !restoredBookIds.has(note.bookId) ||
      typeof note.text !== 'string' ||
      typeof note.note !== 'string' ||
      typeof note.color !== 'string' ||
      typeof note.cfi !== 'string' ||
      typeof note.createdAt !== 'number'
    ) {
      throw new Error('备份笔记格式无效');
    }
    return note;
  });

  await db.transaction('rw', db.books, db.contents, db.notes, async () => {
    await Promise.all([db.books.clear(), db.contents.clear(), db.notes.clear()]);
    await db.books.bulkPut(restoredBooks);
    await db.contents.bulkPut(restoredContents);
    await db.notes.bulkPut(restoredNotes);
  });

  Object.entries(payload.settings || {}).forEach(([key, value]) => {
    if (key.startsWith('mr_') && typeof value === 'string') {
      localStorage.setItem(key, value);
    }
  });
}
