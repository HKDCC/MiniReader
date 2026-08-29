const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

async function recordFrames() {
  const framesDir = path.join(__dirname, 'frames');
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  console.log('Launching browser to capture frames...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1080, height: 680 },
    deviceScaleFactor: 1.5,
  });

  const page = await context.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  let frameCount = 0;
  let isCapturing = true;

  // Frame capture loop in background (12 fps)
  const captureLoop = async () => {
    while (isCapturing) {
      const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(5, '0')}.png`);
      try {
        await page.screenshot({ path: framePath, type: 'png' });
        frameCount++;
      } catch {}
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  const capturePromise = captureLoop();

  // Inject sample book into Dexie IndexedDB
  await page.evaluate(async () => {
    const sampleText1 = `第一章：极简阅读与心智空间

在信息爆炸的时代，我们每天被无数的推文、短视频和即时通讯撕碎注意力。
Mini Reader 的初衷很简单：为你留出一块完全属于深度阅读的纯净领地。

【01 本地优先的哲学】
没有云端追踪，没有弹窗干扰，没有社交算法。
你的书库保存在你的设备本地，随时随地，即点即读。

【02 体验更多的奇妙】
我们所有疯狂的行动，最终目的或许只是体验更多的奇妙。
当你静下心来读完一本书，那种思维层面的顿悟，胜过千百条碎片的刷屏。

【03 阅读的节奏】
好的工具应该像空气一样隐形。
当你沉浸于文字时，界面自然退后；当你需要做笔记时，工具唾手可得。
这就是 Mini Reader 的设计美学。`;

    try {
      const dbRequest = window.indexedDB.open('MiniReaderDB');
      dbRequest.onsuccess = (e) => {
        const db = e.target.result;
        if (db.objectStoreNames.contains('books')) {
          const tx = db.transaction(['books'], 'readwrite');
          const store = tx.objectStore('books');
          store.clear();
          store.add({
            id: 'book-1',
            title: '极简阅读与心智空间.txt',
            author: 'Tech-Linguist Lab',
            format: 'txt',
            fileData: new TextEncoder().encode(sampleText1).buffer,
            size: sampleText1.length,
            cover: null,
            progress: 18,
            lastReadTime: Date.now(),
            sortOrder: 0,
            totalChapters: 3,
            createdAt: Date.now(),
          });
        }
      };
    } catch (err) {}
  });

  // Reload page to reflect injected books
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Scenario 1: Hover bookshelf cards
  console.log('Interacting with bookshelf...');
  await page.mouse.move(360, 240);
  await page.waitForTimeout(800);
  await page.mouse.move(400, 260);
  await page.waitForTimeout(600);

  // Scenario 2: Click to open book
  console.log('Opening book...');
  const card = await page.$('.cursor-pointer');
  if (card) {
    await card.click();
  } else {
    await page.mouse.click(360, 240);
  }
  await page.waitForTimeout(1500);

  // Scenario 3: Reading interaction - page scroll
  console.log('Reading and scrolling...');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(1000);

  // Scenario 4: Change themes
  console.log('Changing themes...');
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = (await btn.innerText()).trim();
    if (text === '暗黑' || text === '夜间' || text === '护眼' || text === '羊皮纸') {
      await btn.click();
      await page.waitForTimeout(800);
    }
  }

  await page.waitForTimeout(1000);

  // Stop capturing
  isCapturing = false;
  await capturePromise;

  await browser.close();
  console.log(`Captured ${frameCount} frames! Compiling GIF & MP4 with ffmpeg...`);

  const gifOutput = path.join(__dirname, 'minireader.gif');
  const mp4Output = path.join(__dirname, 'minireader.mp4');
  const ffmpegExe = 'C:\\ffmpeg\\bin\\ffmpeg.exe';

  // Compile to high-res GIF
  const ffmpegGif = `"${ffmpegExe}" -y -framerate 12 -i "${framesDir}\\frame_%05d.png" -vf "scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" "${gifOutput}"`;
  execSync(ffmpegGif, { stdio: 'inherit' });

  // Compile to MP4
  const ffmpegMp4 = `"${ffmpegExe}" -y -framerate 12 -i "${framesDir}\\frame_%05d.png" -c:v libx264 -pix_fmt yuv420p -vf "scale=720:-2" -movflags +faststart "${mp4Output}"`;
  try {
    execSync(ffmpegMp4, { stdio: 'inherit' });
  } catch {}

  console.log('✅ Success! GIF generated at:', gifOutput);
}

recordFrames().catch(console.error);
