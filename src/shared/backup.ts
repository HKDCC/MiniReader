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
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `mini-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

export async function importLibraryBackup(file: File) {
  const payload = JSON.parse(await file.text());
  if (payload?.app !== 'Mini Reader' || payload?.schemaVersion !== 1) {
    throw new Error('不是有效的 Mini Reader 备份文件');
  }

  const restoredContents = (payload.contents || []).map(deserializeContent);
  const restoredContentById = new Map<string, BookContent>(
    restoredContents.map((content): [string, BookContent] => [content.id, content])
  );
  const restoredBooks = await Promise.all(
    (payload.books || []).map(async (book: any) => {
      if (book.contentHash) return book;

      const content = restoredContentById.get(book.id);
      if (!content) return book;

      return { ...book, contentHash: await hashContent(content.data) };
    })
  );

  await db.transaction('rw', db.books, db.contents, db.notes, async () => {
    await Promise.all([db.books.clear(), db.contents.clear(), db.notes.clear()]);
    await db.books.bulkPut(restoredBooks);
    await db.contents.bulkPut(restoredContents);
    await db.notes.bulkPut(payload.notes || []);
  });

  Object.entries(payload.settings || {}).forEach(([key, value]) => {
    if (key.startsWith('mr_') && typeof value === 'string') {
      localStorage.setItem(key, value);
    }
  });
}
