declare module '*.mjs?url' {
  const value: string;
  export default value;
}

declare module 'electron' {
  export const app: any;
  export const BrowserWindow: any;
  export const dialog: any;
  export const ipcMain: any;
  export const shell: any;
  export const contextBridge: any;
  export const ipcRenderer: any;
}
