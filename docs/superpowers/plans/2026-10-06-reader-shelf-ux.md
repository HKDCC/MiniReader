# Reader and Shelf UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add format-aware page controls and quick seeking, improve the shelf’s recent-book visibility and appearance, and fix the font, copy, and window-control issues.

**Architecture:** Keep navigation and display state in the existing React views. Each document viewer reports its current page information and exposes a progress-seek method; `Reader` owns the shared slider and transition feedback. `Shelf` owns the top-three recent grouping and receives a separately persisted light/dark shelf mode from `App`.

**Tech Stack:** React 19, TypeScript, Electron, epub.js, react-pdf, Dexie, Tailwind CSS v4, Lucide React.

**Spec:** [docs/superpowers/specs/2026-10-06-reader-shelf-ux-design.md](../specs/2026-10-06-reader-shelf-ux-design.md)

## Global Constraints

- Preserve all existing uncommitted working-tree changes; edit the current files incrementally.
- Do not add dependencies, download fonts, or change the Dexie schema.
- Keep shelf theme preferences separate from reader theme preferences.
- Do not add or run tests unless the user asks; use TypeScript typechecking and diff inspection for implementation checks.

## Review Focus

- PDF page bounds, including two-page mode and a final odd page, stay within `1..numPages` (Task 1).
- EPUB progress seeking works before and after the location map is generated; layout changes refresh page information without losing the saved CFI (Task 2).
- TXT seeking crosses chunk boundaries and maps correctly in single-page and two-page layouts (Task 3).
- Slider pointer cancellation, pointer release outside the control, keyboard use, and `0%`/`100%` targets do not lose or repeat a seek (Task 4).
- Missing `lastReadAt`, fewer than three books, manual reorder, and persisted shelf mode all produce stable shelf output (Task 5).

---

### Task 1: Shared page metadata and PDF navigation

**Files:**
- Create: `src/components/readerTypes.ts`
- Modify: `src/components/PdfViewer.tsx`

**Interfaces:**
- Produces `ReaderPageInfo = { current: number; total: number }` and `ReaderLocationChange = (percentage: number, cfi: string, pageInfo?: ReaderPageInfo) => void` for Tasks 2–4.
- PDF viewer exposes `seekToProgress(progress: number): void` on its imperative handle.

- [x] Define the shared page metadata and location callback types in `readerTypes.ts`.
- [x] Update `PdfViewer` to report `{ current: pageNumber, total: numPages }` with its existing normalized progress and CFI.
- [x] Add `seekToProgress(progress)` that clamps progress to `0..1`, converts it to a valid page, and respects single-page or two-page navigation.
- [x] Keep initial CFI restoration and the final odd page bounded to the actual PDF page count.

### Task 2: EPUB page information and progress seeking

**Files:**
- Modify: `src/components/EpubViewer.tsx`
- Consume: `ReaderPageInfo`, `ReaderLocationChange` from Task 1.

**Interfaces:**
- `EpubViewerRef.seekToProgress(progress: number): void` uses the loaded EPUB location map and `rendition.display()`.
- `onLocationChange` reports the current and total reflowed page positions along with progress and CFI.

- [x] Extend `EpubViewerRef` with `seekToProgress(progress)`; convert the clamped normalized value to a CFI using epub.js locations, then display that CFI.
- [x] Include `location.start.displayed.page` and `.total` in relocation metadata. These are the actual layout page and total for the active spine section; the progress slider remains whole-book progress.
- [x] Refresh the active section’s page metadata on rendition relocation after font, width, or spread updates; preserve the current CFI while refreshing.
- [x] Keep the slider’s exact seek value tied to normalized progress even when the displayed page count is being refreshed.

### Task 3: TXT page information and progress seeking

**Files:**
- Modify: `src/components/TxtViewer.tsx`
- Consume: `ReaderPageInfo`, `ReaderLocationChange` from Task 1.

**Interfaces:**
- TXT viewer imperative handle exposes `seekToProgress(progress: number): void`.
- TXT location changes report the page and total page positions for the current layout.

- [x] Measure each text chunk in an offscreen element using the same width, font, line height, column width, and column gap as the visible reader; store per-chunk column counts and cumulative offsets.
- [x] Run measurements after the visible chunk is ready and continue in idle-sized batches; cancel stale work and recalculate after container width, font size, line height, or single/two-page mode changes.
- [x] Derive the book-wide current page from cumulative chunk offsets and the active column; in two-page mode, display the current spread’s first page and count each spread as one slider step.
- [x] Map a clamped progress value to a text offset, then resolve that offset to a chunk and column without iterating through intermediate pages.
- [x] Report page metadata with the existing `txt-{chunkIndex}-{columnIndex}` CFI and percentage, including the first and last page boundaries.

### Task 4: Shared reader controls and quick fade

**Files:**
- Modify: `src/components/Reader.tsx`
- Modify: `src/index.css`
- Consume: viewer page metadata and `seekToProgress` from Tasks 1–3.

**Interfaces:**
- `Reader` accepts optional `ReaderPageInfo` in its existing location callback and stores it for the bottom progress surface.
- Reader viewer handle supports `seekToProgress(progress: number): void` for all three formats.

- [x] Store the latest page metadata and add a local slider preview value distinct from persisted reading progress.
- [x] Replace the passive bottom progress bar with an accessible range input and a current-page/total label; keep percentage as secondary information.
- [x] Update preview state while dragging, then seek once on pointer release or keyboard adjustment; handle pointer cancellation and release outside the slider without stale state.
- [x] Keep progress persistence on viewer-reported location changes so the selected position restores on reopen.
- [x] Trigger a roughly 120ms opacity animation after navigation without delaying viewer commands; disable it under `prefers-reduced-motion`.

### Task 5: Recent-first shelf and persisted acrylic theme

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Shelf.tsx`
- Modify: `src/index.css`

**Interfaces:**
- `App` owns `shelfTheme: 'light' | 'dark'`, persists it under `mr_shelfTheme`, and passes the selected mode and toggle handler to `Shelf`.
- `Shelf` shows the three newest `lastReadAt` books first; all remaining books retain `sortOrder` behavior.

- [x] Derive the recent top three using `lastReadAt`, falling back to `addedAt`; render remaining books in their existing manual order.
- [x] Restrict manual reordering to the remaining books so recent items stay governed by reading activity.
- [x] Remove the manual recent-sort toggle, retain the rest of the shelf actions, and add a light/dark button with accessible label and icon.
- [x] Persist shelf mode separately from reader themes; apply the shelf palette to the shelf surface and Electron title bar only while the shelf is active.
- [x] Apply translucent surfaces, backdrop blur, fine borders, and restrained shadows in both modes while keeping cover art and text legible.

### Task 6: Font selection, removed notice, and window symbols

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/components/Reader.tsx`
- Modify: `src/shared/copy.ts`
- Create: `src/shared/fonts.ts`
- Modify: `src/index.css`

- [x] Register `public/fonts/LXGWWenKai-Regular.ttf` under the `LXGW WenKai` family name and add it as a built-in reading font.
- [x] Add a `Source Han Serif SC` option with a `SimSun` system fallback; add a shared font-stack resolver so built-in family fallbacks reach both EPUB and TXT content styles.
- [x] Retain the valid saved `LXGW WenKai` preference instead of resetting it to `SimSun`.
- [x] Remove the OCR/visual-model download notice from the settings JSX and delete its unused copy entry.
- [x] Replace text-based maximize/restore characters with Lucide square/overlapping-window symbols; preserve state titles and accessible labels.

### Task 7: Type and diff checks

**Files:**
- Review all files changed in Tasks 1–6.

- [x] Run `npm run typecheck` from `Mini Reader`; resolve any errors caused by the new viewer contract or props.
- [x] Run `git diff --check` and inspect the final diff to confirm no unrelated edits or user changes were included.
- [x] Report the check results and any remaining page-count limitation accurately.
