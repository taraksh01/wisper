const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Recording control
  onStartRecording: (callback) => ipcRenderer.on("start-recording", callback),
  onStopRecording: (callback) => ipcRenderer.on("stop-recording", callback),
  setRecordingState: (state) => ipcRenderer.send("set-recording-state", state),
  getRecordingState: () => ipcRenderer.invoke("get-recording-state"),

  // Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),
  pasteToCursor: (text) => ipcRenderer.invoke("paste-to-cursor", text),

  // Window control
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  resizeWindow: (width, height) =>
    ipcRenderer.send("resize-window", width, height),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
