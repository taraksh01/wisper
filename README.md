# Wisper

Wisper is a WisprFlow-like voice dictation application designed for Ubuntu/Linux. It provides seamless voice-to-text integration using AI transcription, allowing you to dictate anywhere and paste the transcribed text.

## Features

- **Global Hotkey Recording** - Press `Shift+Space` to start/stop recording from anywhere
- **AI Transcription** - Transcribe audio using OpenAI Whisper via Groq or OpenAI APIs
- **Minimal UI** - Slim, transparent recording bar (300x60px) with real-time audio waveform
- **Clipboard Integration** - Transcribed text is automatically copied to clipboard
- **System Tray** - Quick access to settings and app controls
- **Separate Settings Window** - Configure API keys and preferences in a dedicated window
- **Wayland & X11 Support** - Works on both display servers
- **Privacy First** - Records locally before sending to API

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

1. Right-click the system tray icon and select **Settings**
2. Choose your API provider:
   - **Groq**: Free, fast Whisper models (recommended)
   - **OpenAI**: Official Whisper API
3. Enter your API key
4. Configure auto-copy option
5. Click **Save Settings**

### Recording

1. Press `Shift+Space` to start recording (slim bar appears with waveform)
2. Speak into your microphone
3. Press `Shift+Space` again to stop
4. Text is transcribed, copied to clipboard, and the bar hides
5. Paste with `Ctrl+V` (or `Ctrl+Shift+V` in terminal)

### System Tray

- **Left-click**: Toggle recording
- **Right-click**: Open menu (Settings, Quit)

## Wayland Setup (GNOME/Debian)

On Wayland, global shortcuts must be configured through your desktop environment since apps cannot register global hotkeys directly.

### Set Up Keyboard Shortcut

1. Open **Settings** → **Keyboard** → **Keyboard Shortcuts** → **View and Customize Shortcuts**
2. Scroll to bottom and click **Custom Shortcuts**
3. Click **Add Shortcut** (+ button)
4. Configure:
   - **Name**: `Wisper Toggle`
   - **Command**: `wisper` (or path to AppImage)
   - **Shortcut**: Press `Shift+Space`
5. Click **Add**

**Note**: Running Wisper while it's already running will toggle recording (single-instance behavior).

For AppImage:
```bash
/path/to/Wisper.AppImage --no-sandbox
```

For development:
```bash
/usr/bin/electron /path/to/wisper --no-sandbox
```

## Configuration

### API Keys

Wisper supports two transcription providers:

| Provider | Model | Cost | Get API Key |
|----------|-------|------|-------------|
| **Groq** (Recommended) | `whisper-large-v3-turbo` | Free | [console.groq.com](https://console.groq.com/) |
| **OpenAI** | `whisper-1` | Paid | [platform.openai.com](https://platform.openai.com/api-keys) |

### Settings

Access settings via system tray → **Settings**

| Option | Description |
|--------|-------------|
| Transcription Provider | Choose between Groq and OpenAI |
| API Key | Your provider's API key |
| Auto-copy | Automatically copy transcription to clipboard (default: on) |

## Requirements

- Linux (Debian/Ubuntu 22.04+ or other distributions)
- Microphone access
- Internet connection (for API calls)

## Building

```bash
# Development
npm run dev              # Start Vite dev server only
npm run electron:dev     # Start Electron with hot reload

# Production
npm run build            # Build React app
npm run package          # Create distributables (.AppImage, .deb)
```

## Troubleshooting

### Global shortcut not working on Wayland
- Wayland doesn't support global shortcuts from apps
- Set up a custom keyboard shortcut in GNOME Settings (see Wayland Setup above)
- The app uses single-instance lock, so running it again toggles recording

### Microphone access denied
- Grant microphone permission in system settings
- Check if another app is using the microphone exclusively

### Transcription failing
- Verify your API key is correct in Settings
- Check your internet connection
- Groq has rate limits on free tier - wait and retry

## License

MIT License - see LICENSE file for details

## Author

Tarak Shaw - [@taraksh01](https://github.com/taraksh01)

## Acknowledgments

- Inspired by [WisprFlow](https://wisprflow.com)
