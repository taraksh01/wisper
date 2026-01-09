const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  clipboard,
  globalShortcut,
} = require("electron");
const localShortcut = require("electron-localshortcut");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isRecording = false;

const isDev = !app.isPackaged;

app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("enable-accelerated-2d-canvas");

let isWayland = false;
try {
  isWayland = process.env.XDG_SESSION_TYPE === "wayland";
} catch (e) {}

// Toggle recording: show+record or stop+hide
function toggleRecording() {
  if (mainWindow) {
    if (!isRecording) {
      positionWindowAtBottom();
      mainWindow.show();
      mainWindow.webContents.send("start-recording");
      isRecording = true;
    } else {
      mainWindow.webContents.send("stop-recording");
      isRecording = false;
    }
  }
}

function positionWindowAtBottom() {
  if (!mainWindow) return;
  const { screen } = require("electron");
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const windowBounds = mainWindow.getBounds();
  const x = Math.round((width - windowBounds.width) / 2);
  const y = Math.round(height - windowBounds.height - 20);
  mainWindow.setPosition(x, y);
}

function createWindow() {
  const { screen } = require("electron");
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const winWidth = 300;
  const winHeight = 60;
  const x = Math.round((width - winWidth) / 2);
  const y = Math.round(height - winHeight - 20);

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, "../assets/icon.png"),
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Hide window when it loses focus (optional - can be removed if annoying)
  mainWindow.on("blur", () => {
    // Only hide if not recording
    if (!isRecording && mainWindow && mainWindow.isVisible()) {
      // Don't auto-hide, let user control via hotkey
    }
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 780,
    frame: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, "../assets/icon.png"),
    title: "Wisper Settings",
  });

  if (isDev) {
    settingsWindow.loadURL("http://localhost:5173/settings.html");
  } else {
    settingsWindow.loadFile(path.join(__dirname, "../dist/settings.html"));
  }

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../assets/icon.png");
  const icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    return;
  }

  const trayIcon = icon.resize({ width: 22, height: 22 });
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Toggle Recording (Shift+Space)",
      click: () => {
        toggleRecording();
      },
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        createSettingsWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Wisper - Voice Dictation");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    toggleRecording();
  });
}

// IPC Handlers
ipcMain.handle("hide-window", async () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle("copy-to-clipboard", async (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("get-recording-state", async () => {
  return isRecording;
});

ipcMain.on("set-recording-state", (event, state) => {
  isRecording = state;
});

const gotTheLock = app.requestSingleInstanceLock();

// Check for --toggle argument
const hasToggleArg = process.argv.includes("--toggle");

if (!gotTheLock) {
  // Another instance exists - it will receive second-instance event
  // and toggle recording
  app.quit();
} else {
  app.on("second-instance", (event, argv) => {
    // Toggle recording when second instance is launched
    if (mainWindow) {
      toggleRecording();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    globalShortcut.unregisterAll();

    // Register global shortcut
    if (!isWayland) {
      globalShortcut.register("Shift+Space", () => {
        toggleRecording();
      });
    }

    // Also register local shortcut for when window is focused
    if (mainWindow) {
      localShortcut.register(mainWindow, "Shift+Space", () => {
        toggleRecording();
      });
    }
  });
}

app.on("window-all-closed", () => {
  // Keep app running in tray
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  if (tray) {
    tray.destroy();
  }
});
