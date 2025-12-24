const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Recording control
  onStartRecording: (callback) => ipcRenderer.on("start-recording", callback),
  onStopRecording: (callback) => ipcRenderer.on("stop-recording", callback),
  setRecordingState: (state) => ipcRenderer.send("set-recording-state", state),
  getRecordingState: () => ipcRenderer.invoke("get-recording-state"),

  // Clipboard and paste
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),
  pasteText: (text) => ipcRenderer.invoke("paste-text", text),

  // Window control
  hideWindow: () => ipcRenderer.invoke("hide-window"),

  // Settings
  onOpenSettings: (callback) => ipcRenderer.on("open-settings", callback),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
