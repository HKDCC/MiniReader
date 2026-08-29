"use strict";

// electron/preload.ts
var import_electron = require("electron");
var validInvokeChannels = ["window:isMaximized", "notes:export-pdf", "files:read", "files:consume-opened"];
var validSendChannels = ["window:minimize", "window:maximize", "window:close"];
var validOnChannels = ["files:opened"];
import_electron.contextBridge.exposeInMainWorld("electron", {
  invoke: (channel, ...args) => {
    if (validInvokeChannels.includes(channel)) {
      return import_electron.ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Invalid channel: ${channel}`));
  },
  send: (channel, ...args) => {
    if (validSendChannels.includes(channel)) {
      import_electron.ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel, callback) => {
    if (validOnChannels.includes(channel)) {
      import_electron.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
  off: (channel, callback) => {
    if (validOnChannels.includes(channel)) {
      import_electron.ipcRenderer.removeListener(channel, callback);
    }
  }
});
