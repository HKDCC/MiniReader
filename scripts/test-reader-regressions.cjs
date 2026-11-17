// Runs real drag/drop and PDF rendering in Electron with a disposable in-memory session.
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  (async () => {
    const { createServer } = await import('vite');
    const server = await createServer({ server: { port: 3178, strictPort: true } });
    await server.listen();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = require('node:child_process').spawn(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
    child.on('exit', async (code) => { await server.close(); process.exitCode = code ?? 1; });
  })().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(app.getPath('temp'), `mini-reader-regressions-${process.pid}`));
  app.disableHardwareAcceleration();
  const failures = [];
  const pdfErrors = [];
  const appUrl = `http://localhost:3178${process.argv.includes('--built') ? '/dist/index.html' : ''}`;
  let window;
  const run = (fn, ...args) => window.webContents.executeJavaScript(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
  const waitFor = async (fn, message) => {
    const passed = await window.webContents.executeJavaScript(`(async () => {
      const check = (${fn});
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (check()) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    })()`);
    if (passed) return;
    const state = await run(() => ({ text: document.body.innerText.slice(0, 600), cards: [...document.querySelectorAll('[data-book-id]')].filter(node => /regression/.test(node.textContent)).map(node => ({text: node.textContent, cls: node.className, rect: node.getBoundingClientRect().toJSON()})), shelf: document.querySelector('[data-shelf-theme].overflow-y-auto')?.scrollTop }));
    throw new Error(`${message}: ${JSON.stringify(state)}`);
  };
  const test = async (name, fn) => {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}\n${pdfErrors.join('\n')}`); }
  };
  function makePdf() {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
      null,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
      null,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    for (const [index, label] of [[3, 'FIRST PAGE'], [5, 'SECOND PAGE']]) {
      const stream = `0.2 0.4 0.6 rg 40 40 100 100 re f 0 0 0 rg BT /F1 24 Tf 40 500 Td (${label}) Tj ET`;
      objects[index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf).toString('base64');
  }
  app.whenReady().then(async () => {
    window = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false, partition: `regressions-${process.pid}` } });
    window.webContents.on('console-message', ({ message }) => {
      if (/detached|ArrayBuffer|load PDF|Worker|UnknownError/i.test(message)) pdfErrors.push(message);
    });
    await window.loadURL(appUrl);
    await run(() => localStorage.setItem('mr_isTwoPage', 'false'));
    await window.loadURL(appUrl);
    await waitFor(() => !!document.querySelector('[data-book-id]'), 'Shelf did not mount');
    await run(async () => {
      const { db } = await import('/src/db/db.ts');
      await db.books.clear();
      await db.contents.clear();
      for (let i = 0; i < 45; i++) {
        await db.books.add({ id: `seed-${i}`, title: `Book ${i}`, author: 'Test', format: 'txt', progress: 0, addedAt: i, lastReadAt: i, sortOrder: i });
        await db.contents.add({ id: `seed-${i}`, data: 'Seed book' });
      }
    });
    await waitFor(() => document.querySelectorAll('[data-book-id]').length === 45, 'Seed books did not render');
    await test('dragging a new book locates and highlights its card after the live query updates', async () => {
      await run(() => {
        const shelf = document.querySelector('[data-shelf-theme].overflow-y-auto');
        shelf.scrollTop = shelf.scrollHeight;
        const transfer = new DataTransfer();
        transfer.items.add(new File(['Newly imported book'], 'Focus regression.txt', { type: 'text/plain' }));
        shelf.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      });
      await waitFor(() => {
        const card = [...document.querySelectorAll('[data-book-id]')].find(node => node.textContent.includes('Focus regression'));
        if (!card) return false;
        const rect = card.getBoundingClientRect();
        return card.classList.contains('ring-4') && rect.top >= 0 && rect.bottom <= innerHeight;
      }, 'Imported card was not scrolled into view and highlighted');
    });
    await test('PDF renders real page pixels and remains readable after updates, resize and reopen', async () => {
      await run(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'PDF regression.pdf', { type: 'application/pdf' }));
        const input = document.querySelector('input[accept=".txt,.epub,.pdf"]');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, makePdf());
      await waitFor(() => [...document.querySelectorAll('[data-book-id]')].some(node => node.textContent.includes('PDF regression')), 'Imported PDF card missing');
      await run(() => {
        const card = [...document.querySelectorAll('[data-book-id]')].find(node => node.textContent.includes('PDF regression'));
        window.__pdfBookId = card.dataset.bookId;
        card.click();
      });
      const readable = () => {
        const canvas = document.querySelector('.react-pdf__Page canvas');
        if (!canvas || canvas.width < 100 || canvas.height < 100) return false;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] && data[i] < 150 && data[i + 2] > data[i] + 20) colored++;
        return colored > 100 && document.querySelector('.react-pdf__Page__textContent')?.textContent.includes('PAGE');
      };
      await waitFor(readable, 'PDF never rendered colored pixels and selectable text');
      await run(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
      await waitFor(() => document.querySelector('.react-pdf__Page__textContent')?.textContent.includes('SECOND PAGE'), 'PDF next page failed');
      window.setSize(950, 700);
      await waitFor(readable, 'PDF disappeared after resize');
      await run(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await waitFor(() => !!document.querySelector(`[data-book-id="${window.__pdfBookId}"]`), 'Return to shelf failed');
      await run(() => document.querySelector(`[data-book-id="${window.__pdfBookId}"]`).click());
      await waitFor(readable, 'PDF disappeared on reopen');
      assert.equal(pdfErrors.length, 0, pdfErrors.join('\n'));
    });
    await test('PDF highlights preserve the visible glyphs underneath every note color', async () => {
      await run(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
      await waitFor(() => document.querySelector('.react-pdf__Page__textContent')?.textContent.includes('FIRST PAGE'), 'First page missing');
      await waitFor(() => {
        let element = document.querySelector('.react-pdf__Page');
        if (!element) return false;
        while (element) {
          if (Number(getComputedStyle(element).opacity) < 0.99) return false;
          element = element.parentElement;
        }
        return true;
      }, 'Reader fade animation did not finish');
      const rect = await run(() => {
        const span = [...document.querySelectorAll('.textLayer span')].find(node => node.textContent === 'FIRST PAGE');
        const rect = span.getBoundingClientRect();
        return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      });
      const textPixels = async () => {
        // Offscreen windows paint asynchronously after React/text-layer updates.
        await new Promise(resolve => {
          const onPaint = () => { clearTimeout(timeout); resolve(); };
          const timeout = setTimeout(() => { window.webContents.removeListener('paint', onPaint); resolve(); }, 1000);
          window.webContents.once('paint', onPaint);
          window.webContents.invalidate();
        });
        const image = await window.webContents.capturePage(rect);
        const pixels = image.toBitmap();
        let dark = 0;
        let tinted = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] < 80 && pixels[i + 1] < 80 && pixels[i + 2] < 80) dark++;
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) tinted++;
        }
        return { dark, tinted };
      };
      await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const { dark: original } = await textPixels();
      assert.ok(original > 50, `Fixture must contain visible black glyphs: ${original}, ${JSON.stringify(rect)}`);
      for (const color of ['#fcd34d', '#86efac', '#fca5a5']) {
        await run(async color => {
          window.__expectedHighlightColor = color;
          const { db } = await import('/src/db/db.ts');
          await db.notes.where('bookId').equals(window.__pdfBookId).delete();
          await db.notes.add({ bookId: window.__pdfBookId, text: 'FIRST PAGE', note: '', color, cfi: 'pdf-page-1-0-10', createdAt: Date.now() });
        }, color);
        await waitFor(() => document.querySelector('.textLayer mark')?.getAttribute('style').includes(window.__expectedHighlightColor), 'Saved PDF highlight missing');
        // Allow the new text layer to reach the compositor before pixel comparison.
        await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const { dark: visible, tinted } = await textPixels();
        assert.ok(visible >= original * 0.9, `${color} hides glyphs: ${visible}/${original} dark pixels remain`);
        assert.ok(tinted > 50, `${color} highlight must visibly tint the paper`);
      }
    });
    console.log(`${3 - failures.length}/3 regression tests passed`);
    app.exit(failures.length ? 1 : 0);
  }).catch(error => { console.error(error); app.exit(1); });
}
