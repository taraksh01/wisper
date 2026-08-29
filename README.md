# Wisper

Turn your voice into text right on your device, with your privacy always in your hands. Just speak, and your words are ready to paste anywhere. Everything stays on your computer by default, with optional cloud providers available whenever you choose to use them.

Wisper is a lightweight, privacy-first desktop dictation app for Linux. Press a global hotkey, speak, and the transcribed text is inserted wherever your cursor is. An optional AI step can clean up and format the result before it lands.

## Features

- **Speak instead of type** - press a global hotkey (hold for push-to-talk or tap for toggle mode), say what you want, and the text lands wherever your cursor is.
- **Stays on your device** - transcription runs locally with ONNX models; nothing leaves your computer unless you choose a cloud provider.
- **Pick your microphone** - choose a specific input device, or let the system default handle it.
- **Cleans up as it goes** - optional AI step reformats and polishes the transcript (6 Writing Styles: Auto, Clean-up, Email, Developer, Messaging, Formal + Custom; 6 providers: OpenAI, Anthropic, Groq, OpenRouter, Ollama, OpenCode Go + Custom with endpoint-aware `/chat/completions` `/responses` `/messages` and Test connection), compact deduplicated output with typo/filler fixes, plus silence trimming.
- **Your words, your way** - custom vocabulary turns shortcuts into proper terms (say "gpt", get "GPT").
- **Look back** - searchable history lets you replay the recording, re-transcribe, or edit any past dictation, and shows how much typing time you've saved.
- **Out of the way** - lives in the system tray; close the window and it keeps running, ready for the next hotkey.
- **Updates itself** - checks GitHub releases and installs new versions in-app.

## How it works

```
Speak → Record → Transcribe → [Refine] → Insert
```

You speak, Wisper records locally, transcribes your voice to text, optionally refines it with an AI model, then types it at your cursor or copies it to the clipboard.

## Requirements

Wisper inserts text by simulating a paste/keystroke into whatever app is focused. How well this works depends on your display server and which paste helper is installed:

- **ydotool ≥1.0.4 (recommended on Wayland)** - injects keystrokes through a kernel `uinput` virtual device, so it works on **both X11 and Wayland with no permission prompt**. It needs the `ydotoold` daemon running and your user in the `input` group. **1.0.4 is required** - older distro packages (e.g. Ubuntu 22.04 ships 0.x) lack the `-d`/`-H` timing flags Wisper uses for lightning-fast direct typing (`-d 0 -H 0`) and will be noticeably slower or may error.
- **wtype** - a zero-config Wayland tool, but it only works on compositors that implement the Wayland `virtual-keyboard` protocol. On compositors that don't (you'll see `Compositor does not support the virtual keyboard protocol`), wtype fails entirely.
- **enigo (built-in fallback)** - no install needed. Wisper now uses it with `linux_delay: 0` for fastest typing, but on native Wayland it goes through the desktop **RemoteDesktop portal**, so the system pops a **"remote desktop / input capture" permission prompt** (usually one-time if you let the compositor remember it).

### Setting up ydotool ≥1.0.4 (no prompts)

> **Why 1.0.4?** See [`docs/ydotool-setup.md`](docs/ydotool-setup.md) - Wisper runs `ydotool type -d 0 -H 0` for lightning typing; older versions ignore `-H` and fall back to `20ms` (≈2s/100 chars vs ≈50ms).

Quick setup - full guide in [`docs/ydotool-setup.md`](docs/ydotool-setup.md):

```bash
# Ubuntu 26.04 already ships 1.0.4; older distros: build from source
# https://github.com/ReimuNotMoe/ydotool#building-from-source
sudo systemctl enable --now ydotoold.service
sudo usermod -aG input $USER  # then relogin
ydotool type -d 0 -H 0 "hello world"   # should appear instantly
```

### About the RemoteDesktop portal prompt (enigo / wtype)

On Wayland, `enigo` and `wtype` ask the compositor for permission to inject input, which surfaces as a **"remote desktop" / "remote control"** dialog. This is expected - grant it and tick **remember** so it isn't re-asked. `ydotool` avoids this entirely because it uses `uinput` below the compositor.

By default Wisper auto-detects the best available tool, but you can pick a specific one under **General → Output → Paste Tool**. The app also shows a warning there if you're on Wayland without a suitable tool installed.

> **Why does it ask for remote desktop permission?** When you use the **built-in** paste tool on Wayland, Wisper has no direct way to type into other apps, so it routes input through the XDG Desktop Portal's RemoteDesktop interface - the same mechanism screen-sharing tools use - which requires your consent. This is a Wayland limitation, not a bug. Installing `wtype` or `ydotool` avoids the portal (and the prompt) entirely, since they inject input through dedicated channels.

> **Note:** If you install the `.deb` or `.rpm` package, these tools may be pulled in automatically. AppImage users should install them manually as shown above.

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Tauri v2 (Rust)
- **STT:** local ONNX models + optional cloud APIs (OpenAI-compatible)
- **Platform:** Linux (X11 and Wayland), distributed as AppImage / deb / rpm

## Development

Prerequisites: [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/), and [pnpm](https://pnpm.io/), plus the [Tauri Linux system dependencies](https://tauri.app/start/prerequisites/). For paste testing, `ydotool ≥1.0.4` is recommended (see Requirements - older versions lack `-d 0 -H 0` and will be slower).

```bash
# install JS dependencies
pnpm install

# dev: Wisper Dev (violet) - isolated config, runs alongside installed Wisper
pnpm tauri:dev

# prod bundle (orange) - AppImage / deb / rpm
pnpm tauri build
# alias:
pnpm tauri:build
```

### Dev vs Prod flavours

Wisper ships as two logical apps from the same branch so you can develop without clobbering your daily driver:

|  | Prod (`pnpm tauri build`) | Dev (`pnpm tauri:dev`) |
|---|---|---|
| **Name / ID** | `Wisper` / `com.taraksh01.wisper` | `Wisper Dev` / `com.taraksh01.wisper-dev` |
| **Accent** | orange `#ea580c` / `#c2410c` | violet `#7c3aed` / `#6d28d9` |
| **Icons** | `icons/*` + `public/wisper.svg` | `icons/dev/*` + `public/dev/wisper-dev.svg` + `public/overlay-dev.html` |
| **Config** | `~/.config/wisper/settings.json` | `~/.config/wisper-dev/settings.json` |
| **Data** | `~/.local/share/wisper/{history.db,words.db,models,recordings}` | `~/.local/share/wisper-dev/{…}` |
| **Storage** | `localStorage wisper:*` | `localStorage wisper-dev:*` |
| **Wayland** | `enableGTKAppId` → `app_id = com.taraksh01.wisper` | `enableGTKAppId` → `app_id = com.taraksh01.wisper-dev` (separate dock grouping) |

Both tray and window icons are embedded per-flavour (`tauri image-png` + `win.set_icon` in debug) so you can tell them apart in the system tray/dock while running side-by-side. Dev starts fresh - no auto-copy from prod config.

## Releases & Auto-update

Wisper checks the latest GitHub release and can download and install updates from within the app. Update artifacts are signed; the private signing key is kept out of the repository and supplied via environment variables at build time.

## License

See the repository for license details.
