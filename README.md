# Wisper

Wisper is a WisprFlow-like voice dictation application designed for Ubuntu/Linux. It provides seamless voice-to-text integration using AI transcription, allowing you to dictate anywhere and have the text automatically pasted.

## Features

- **Global Hotkey Recording** - Press `Shift+Space` to start/stop recording from anywhere
- **AI Transcription** - Transcribe audio using OpenAI Whisper via Groq or OpenAI APIs
- **Auto-Paste** - Automatically paste transcribed text into your active window
- **Floating UI** - Always-on-top glassmorphism window with real-time audio waveform visualization
- **System Tray** - Quick access to settings and app controls from the system tray
- **Clipboard Integration** - Copy transcribed text to clipboard with one click
- **Wayland Support** - Works on both X11 and Wayland display servers
- **Offline Recording** - Records locally before sending to API for privacy

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/taraksh01/wisper.git
cd wisper

# Install dependencies
npm install

# Run in development
npm run electron:dev

# Build for production
npm run build
npm run package
```

### From Release

Download the latest `.AppImage` or `.deb` package from the [Releases](https://github.com/taraksh01/wisper/releases) page and install it.

## Usage

### First Time Setup

1. Click the settings icon (⚙️) in the Wisper window
2. Choose your API provider:
   - **Groq**: Free, fast Whisper models
   - **OpenAI**: Official Whisper API
3. Enter your API key
4. Wisper will remember your settings

### Recording

1. Press `Shift+Space` to start recording
2. Speak into your microphone
3. Press `Shift+Space` again to stop
4. The transcription appears and is automatically pasted

### From System Tray

- **Click tray icon**: Show/hide Wisper window
- **Right-click**: Access menu for settings and quit

## Configuration

### API Keys

Wisper supports two transcription providers:

- **Groq** (Recommended): Get your free API key at https://console.groq.com/
  - Model: `whisper-large-v3-turbo`
  - Faster and more affordable

- **OpenAI**: Get your API key at https://platform.openai.com/api-keys
  - Model: `whisper-1`
  - Official implementation

### Settings

Access settings by:
- Clicking the gear icon in the UI
- Right-clicking the tray icon → Settings / API Key

## Requirements

- Ubuntu 22.04+ or other Linux distributions
- Electron-compatible graphics drivers
- Microphone access
- For X11: `xdotool` installed
- For Wayland: `ydotool` installed

## Building

```bash
# Development mode
npm run dev              # Start Vite dev server
npm run electron:dev     # Start Electron with hot reload

# Production build
npm run build            # Build React app
npm run package          # Create distributables (.AppImage, .deb)

# Build options
--linux AppImage         # Build AppImage
--linux deb              # Build Debian package
```

## Technical Details

- **Frontend**: React + TypeScript + Vite
- **Desktop**: Electron
- **Styling**: Tailwind CSS v4
- **Audio**: Web Audio API for real-time visualization
- **Transcription**: OpenAI Whisper API (Groq or OpenAI)
- **Hotkeys**: Electron GlobalShortcut with Wayland support
- **Clipboard**: Electron Clipboard API with xdotool/ydotool for paste

## Troubleshooting

### Global shortcut not working
- Check if another app is using `Shift+Space`
- On Wayland, ensure GlobalShortcutsPortal is enabled (automatic)

### Paste not working
- Ensure `xdotool` (X11) or `ydotool` (Wayland) is installed
- Check that your window manager supports keyboard simulation

### Microphone access denied
- Grant microphone permission in system settings
- Check if another app is using the microphone

## License

MIT License - see LICENSE file for details

## Author

Tarak Shaw - [@taraksh01](https://github.com/taraksh01)

## Acknowledgments

- Inspired by WisprFlow
- Powered by OpenAI Whisper
- UI designed with glassmorphism aesthetics
