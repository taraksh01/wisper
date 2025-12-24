const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  clipboard,
  nativeImage,
  globalShortcut,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let tray = null;
let isRecording = false;

// Check if running in development
const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false, // Fixed size
    movable: false, // Fixed position
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "../assets/icon.png"),
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    // Open DevTools in development
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Position window: horizontally centered, 10% from bottom
  const { screen } = require("electron");
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const windowWidth = 320;
  const windowHeight = 350;
  const x = Math.round((width - windowWidth) / 2); // Horizontally centered
  const y = Math.round(height - windowHeight - height * 0.1); // 10% from bottom
  mainWindow.setPosition(x, y);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../assets/icon.png");
  const icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    console.error("Failed to create tray icon from:", iconPath);
    // Be resilient, but log error
  }

  // Resize for tray if needed, though Electron usually handles this.
  // For Linux tray, 22x22 or 24x24 is typical.
  // nativeImage handles scaling usually, but we can force it if it looks huge.
  // Let's try native scaling first.
  const trayIcon = icon.resize({ width: 22, height: 22 });

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show/Hide Window",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
          }
        }
      },
    },
    { type: "separator" },
    {
      label: "Settings / API Key",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send("open-settings");
        }
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
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

const FIXED_HOTKEY = "Shift+Space";

function registerGlobalShortcut() {
  // Unregister all previous shortcuts first
  globalShortcut.unregisterAll();

  const ret = globalShortcut.register(FIXED_HOTKEY, () => {
    if (mainWindow) {
      if (!isRecording) {
        isRecording = true;
        mainWindow.webContents.send("start-recording");
        mainWindow.showInactive(); // Show without stealing focus
      } else {
        isRecording = false;
        mainWindow.webContents.send("stop-recording");
      }
    }
  });

  if (!ret) {
    console.error(`Failed to register global shortcut: ${FIXED_HOTKEY}`);
    console.log(
      "Try checking if another app is using this shortcut or if it's reserved by the OS."
    );
    return false;
  }
  console.log(`Global shortcut registered successfully: ${FIXED_HOTKEY}`);
  return true;
}

// IPC Handlers
ipcMain.handle("copy-to-clipboard", async (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("paste-text", async (event, text) => {
  clipboard.writeText(text);

  // Wait a moment for clipboard to be ready
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Try xdotool first (X11), fallback to ydotool (Wayland)
  const xdotool = spawn("xdotool", ["key", "--clearmodifiers", "ctrl+v"]);

  xdotool.on("error", () => {
    // xdotool failed (maybe Wayland), try ydotool
    // Key codes: 29=Ctrl, 47=V
    const ydotool = spawn("ydotool", ["key", "29:1", "47:1", "47:0", "29:0"]);
    ydotool.on("error", (err) => {
      console.error("Failed to simulate paste:", err.message);
    });
  });

  return true;
});

ipcMain.handle("hide-window", async () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle("get-recording-state", async () => {
  return isRecording;
});

ipcMain.on("set-recording-state", (event, state) => {
  isRecording = state;
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  registerGlobalShortcut();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Don't quit on window close, keep in tray
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  if (tray) {
    tray.destroy();
  }
});
