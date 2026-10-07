const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const appUserModelId = 'com.quaxstudio.minireader';
const appPath = 'D:\\MiniReader\\Mini Reader.exe';
const appDirectory = 'D:\\MiniReader';
const iconPath = 'D:\\MiniReader\\resources\\app-icon.ico';
const shortcutPaths = [
  'C:/Users/hkdcc/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Mini Reader.lnk',
  'C:/Users/hkdcc/AppData/Roaming/Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Mini Reader.lnk',
  'C:/Users/hkdcc/AppData/Roaming/Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Mini Reader (2).lnk',
  'C:/Users/hkdcc/Desktop/Mini Reader.lnk',
];

app.setPath('userData', path.join(__dirname, '..', '.tmp-repair-pinned-icons-userdata'));
app.whenReady().then(() => {
  let updated = 0;
  for (const shortcutPath of shortcutPaths) {
    if (!fs.existsSync(shortcutPath)) continue;
    const current = shell.readShortcutLink(shortcutPath);
    if (path.resolve(current.target).toLowerCase() !== appPath.toLowerCase()) continue;

    const didUpdate = shell.writeShortcutLink(shortcutPath, 'update', {
      ...current,
      target: appPath,
      cwd: appDirectory,
      icon: iconPath,
      iconIndex: 0,
      appUserModelId,
    });
    if (!didUpdate) throw new Error(`Could not update shortcut: ${shortcutPath}`);

    const updatedShortcut = shell.readShortcutLink(shortcutPath);
    if (updatedShortcut.appUserModelId !== appUserModelId || updatedShortcut.icon !== iconPath) {
      throw new Error(`Shortcut verification failed: ${shortcutPath}`);
    }
    console.log(`Updated ${shortcutPath}`);
    updated += 1;
  }

  console.log(`Verified ${updated} Mini Reader shortcuts.`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
