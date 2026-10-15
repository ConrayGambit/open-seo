// Bridge for the local settings window only; the OpenSEO web app itself runs
// without a preload.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openseoDesktop", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (input) => ipcRenderer.invoke("settings:save", input),
});
