const BOOK_DRAG_MIME = 'application/x-minireader-book';

export function isExternalFileDrag(types: Iterable<string>): boolean {
  const typeList = Array.from(types);
  return typeList.includes('Files') && !typeList.includes(BOOK_DRAG_MIME);
}

export function isInternalBookDrag(types: Iterable<string>): boolean {
  return Array.from(types).includes(BOOK_DRAG_MIME);
}

export function setBookDragData(dataTransfer: DataTransfer, bookId: string) {
  dataTransfer.setData(BOOK_DRAG_MIME, bookId);
  dataTransfer.effectAllowed = 'move';
}

export function getBookDragId(dataTransfer: DataTransfer) {
  return dataTransfer.getData(BOOK_DRAG_MIME);
}
