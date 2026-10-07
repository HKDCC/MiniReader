import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { BookMeta } from '../../db/db';

type DragSession = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  ghost: HTMLElement | null;
  rect: DOMRect;
  order: BookMeta[];
  frame: number;
  detach: () => void;
};

export function useShelfReorder(
  books: BookMeta[],
  shelfRef: RefObject<HTMLDivElement | null>,
  gridRef: RefObject<HTMLDivElement | null>,
  bookRefs: RefObject<Map<string, HTMLDivElement>>,
  onCommit: (books: BookMeta[]) => Promise<void>,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const settlingRef = useRef(new Set<HTMLElement>());
  const suppressedClickUntil = useRef(0);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!sessionRef.current && previewIds && books.map(book => book.id).join('|') === previewIds.join('|')) {
      setPreviewIds(null);
    }
  }, [books, previewIds, draggingId]);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session) {
      session.detach();
      cancelAnimationFrame(session.frame);
      session.ghost?.remove();
    }
    settlingRef.current.forEach(ghost => ghost.remove());
    document.body.classList.remove('shelf-is-reordering');
  }, []);

  const beginDrag = (event: PointerEvent<HTMLDivElement>, book: BookMeta) => {
    if (event.button !== 0 || sessionRef.current || savingRef.current || !event.isPrimary) return;
    // Touch scrolling remains native; desktop dragging follows the pointer.
    if (event.pointerType === 'touch') return;
    const element = event.currentTarget;
    const session: DragSession = {
      id: book.id, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      active: false, ghost: null, rect: element.getBoundingClientRect(),
      order: [...books], frame: 0, detach: () => {},
    };
    sessionRef.current = session;

    const update = () => {
      if (sessionRef.current !== session || !session.active) return;
      const shelf = shelfRef.current;
      const grid = gridRef.current;
      if (!shelf || !grid) return;
      session.ghost!.style.transform = `translate3d(${session.x - session.startX}px, ${session.y - session.startY}px, 0) rotate(-1.5deg) scale(1.04)`;

      const bounds = shelf.getBoundingClientRect();
      const toolbarBottom = shelf.querySelector('header')?.getBoundingClientRect().bottom ?? bounds.top;
      const upperEdge = toolbarBottom + 28;
      const lowerEdge = bounds.bottom - 48;
      const scrollSpeed = session.y < upperEdge ? -Math.min(10, (upperEdge - session.y) / 6)
        : session.y > lowerEdge ? Math.min(10, (session.y - lowerEdge) / 6) : 0;
      if (session.y >= bounds.top && session.y <= bounds.bottom && session.x >= bounds.left && session.x <= bounds.right) {
        shelf.scrollTop += scrollSpeed;
      }

      const gridBounds = grid.getBoundingClientRect();
      // Read layout slots, not animated rectangles, so moving neighbors cannot oscillate the order.
      const slots = session.order.map(item => {
        const card = bookRefs.current.get(item.id);
        if (!card) return null;
        return { id: item.id, x: gridBounds.left + card.offsetLeft + card.offsetWidth / 2,
          y: gridBounds.top + card.offsetTop + card.offsetHeight / 2, top: gridBounds.top + card.offsetTop };
      }).filter(slot => slot !== null);
      const firstManualTop = Math.min(...slots.map(slot => slot.top));
      if (session.x >= gridBounds.left - 20 && session.x <= gridBounds.right + 20 && session.y >= firstManualTop && session.y <= gridBounds.bottom + 20) {
        const target = slots.reduce<typeof slots[number] | null>((nearest, slot) => {
          const distance = (slot.x - session.x) ** 2 + (slot.y - session.y) ** 2;
          const previousDistance = nearest ? (nearest.x - session.x) ** 2 + (nearest.y - session.y) ** 2 : Infinity;
          return distance < previousDistance ? slot : nearest;
        }, null);
        if (target && target.id !== session.id) {
          const next = [...session.order];
          const from = next.findIndex(item => item.id === session.id);
          const to = next.findIndex(item => item.id === target.id);
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          session.order = next;
          setPreviewIds(next.map(item => item.id));
        }
      }
      session.frame = requestAnimationFrame(update);
    };

    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== session.pointerId) return;
      session.x = pointer.clientX;
      session.y = pointer.clientY;
      if (!session.active && Math.hypot(session.x - session.startX, session.y - session.startY) >= 7) {
        session.active = true;
        const ghost = element.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('data-book-id');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.setAttribute('data-shelf-theme', shelfRef.current?.dataset.shelfTheme || 'light');
        ghost.classList.add('shelf-drag-ghost');
        Object.assign(ghost.style, { position: 'fixed', left: `${session.rect.left}px`, top: `${session.rect.top}px`,
          width: `${session.rect.width}px`, height: `${session.rect.height}px`, opacity: '1',
          color: getComputedStyle(element).color, zIndex: '1000', pointerEvents: 'none', transition: 'none' });
        document.body.appendChild(ghost);
        session.ghost = ghost;
        document.body.classList.add('shelf-is-reordering');
        setDraggingId(session.id);
        setPreviewIds(session.order.map(item => item.id));
        session.frame = requestAnimationFrame(update);
      }
      if (session.active) pointer.preventDefault();
    };

    const finish = (cancelled: boolean) => {
      if (sessionRef.current !== session) return;
      session.detach();
      cancelAnimationFrame(session.frame);
      sessionRef.current = null;
      document.body.classList.remove('shelf-is-reordering');
      setDraggingId(null);
      if (!session.active) return;
      suppressedClickUntil.current = performance.now() + 350;
      if (cancelled) setPreviewIds(null);
      else {
        savingRef.current = true;
        void onCommit(session.order).catch(() => setPreviewIds(null)).finally(() => { savingRef.current = false; });
      }

      const ghost = session.ghost!;
      settlingRef.current.add(ghost);
      requestAnimationFrame(() => {
        if (!ghost.isConnected) return;
        const card = bookRefs.current.get(session.id);
        const grid = gridRef.current;
        if (!card || !grid) { ghost.remove(); settlingRef.current.delete(ghost); return; }
        const rect = grid.getBoundingClientRect();
        const x = rect.left + card.offsetLeft - session.rect.left;
        const y = rect.top + card.offsetTop - session.rect.top;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const animation = ghost.animate([
          { transform: ghost.style.transform, opacity: 1 },
          { transform: `translate3d(${x}px, ${y}px, 0) rotate(0deg) scale(1)`, opacity: 0 },
        ], { duration: reducedMotion ? 0 : 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
        animation.onfinish = () => { ghost.remove(); settlingRef.current.delete(ghost); };
      });
    };
    const up = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId === session.pointerId) {
        const shelf = shelfRef.current?.getBoundingClientRect();
        const cancelled = !shelf || pointer.clientX < shelf.left || pointer.clientX > shelf.right || pointer.clientY < shelf.top || pointer.clientY > shelf.bottom;
        if (session.active && !cancelled) {
          session.x = pointer.clientX;
          session.y = pointer.clientY;
          cancelAnimationFrame(session.frame);
          update();
        }
        finish(cancelled);
      }
    };
    const cancel = () => finish(true);
    const escape = (key: KeyboardEvent) => { if (key.key === 'Escape') finish(true); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    session.detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
    };
  };

  const byId = new Map(books.map(book => [book.id, book]));
  const orderedBooks = previewIds
    ? [...previewIds.map(id => byId.get(id)).filter(book => book !== undefined), ...books.filter(book => !previewIds.includes(book.id))]
    : books;

  return { draggingId, orderedBooks, beginDrag, shouldSuppressClick: () => performance.now() < suppressedClickUntil.current };
}
