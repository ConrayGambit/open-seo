// Bridge for the local settings window only; the OpenSEO web app itself runs
// without a preload.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openseoDesktop", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (input) => ipcRenderer.invoke("settings:save", input),
  exportTeamSetup: (password) => ipcRenderer.invoke("team:export", password),
  importTeamSetup: (password) => ipcRenderer.invoke("team:import", password),
});
