const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, '..', '.tmp-icon-ico-userdata'));

const iconSizes = [
  { size: 24, pageStroke: 18, bindingStroke: 24 },
  { size: 32, pageStroke: 16, bindingStroke: 20 },
  { size: 48, pageStroke: 12, bindingStroke: 16 },
  { size: 64, pageStroke: 10, bindingStroke: 14 },
  { size: 96, pageStroke: 8, bindingStroke: 12 },
  { size: 128, pageStroke: 8, bindingStroke: 12 },
  { size: 256, pageStroke: 8, bindingStroke: 12 },
];

function createIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let imageOffset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const offset = index * 16;
    directory[offset] = entry.size === 256 ? 0 : entry.size;
    directory[offset + 1] = entry.size === 256 ? 0 : entry.size;
    directory.writeUInt16LE(1, offset + 4);
    directory.writeUInt16LE(32, offset + 6);
    directory.writeUInt32LE(entry.png.length, offset + 8);
    directory.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

app.whenReady().then(async () => {
  const svgPath = path.resolve(__dirname, '..', 'public', 'logo-preview-rounded-warm-paper.svg');
  const iconPath = path.resolve(__dirname, '..', 'public', 'app-icon.ico');
  const sourceSvg = fs.readFileSync(svgPath, 'utf8');
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
  });

  await window.loadURL('data:text/html;charset=utf-8,<html><body style="margin:0"></body></html>');
  const entries = [];

  for (const { size, pageStroke, bindingStroke } of iconSizes) {
    const svg = sourceSvg
      .replace(/stroke-width="8"/g, `stroke-width="${pageStroke}"`)
      .replace(/stroke-width="12"/g, `stroke-width="${bindingStroke}"`);
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const script = `new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${size};
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = reject;
      image.src = ${JSON.stringify(svgUrl)};
    })`;
    const dataUrl = await window.webContents.executeJavaScript(script);
    entries.push({ size, png: Buffer.from(dataUrl.split(',')[1], 'base64') });
  }

  fs.writeFileSync(iconPath, createIco(entries));
  console.log(`Wrote ${entries.length} icon layers to ${iconPath}: ${entries.map(({ size }) => `${size}x${size}`).join(', ')}`);
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
