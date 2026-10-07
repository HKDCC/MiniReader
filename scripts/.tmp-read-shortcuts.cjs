const { app, shell } = require('electron');
const path = require('path');
app.setPath('userData', path.join(__dirname, '..', '.tmp-shortcut-inspect'));
app.whenReady().then(() => {
  const links = [
    'C:/Users/hkdcc/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Mini Reader.lnk',
    'C:/Users/hkdcc/AppData/Roaming/Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Mini Reader.lnk',
    'C:/Users/hkdcc/AppData/Roaming/Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Mini Reader (2).lnk',
  ];
  for (const link of links) {
    try { console.log(link, shell.readShortcutLink(link)); }
    catch (error) { console.log(link, error.message); }
  }
  app.quit();
});
