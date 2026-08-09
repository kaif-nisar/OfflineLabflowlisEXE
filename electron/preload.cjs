const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("LabFlowDesktopShell", {
    platform: process.platform,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    saveAndOpenPdf: async ({ fileName, buffer }) => {
        return ipcRenderer.invoke("labflow:save-and-open-pdf", { fileName, buffer });
    },
});
