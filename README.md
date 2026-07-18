# Wisper

Turn your voice into text right on your device, with your privacy always in your hands. Just speak, and your words are ready to paste anywhere. Everything stays on your computer by default, with optional cloud providers available whenever you choose to use them.

Wisper is a lightweight, privacy-first desktop dictation app for Linux. Press a global hotkey, speak, and the transcribed text is inserted wherever your cursor is. An optional AI step can clean up and format the result before it lands.

## Features

- **Speak instead of type** — press a global hotkey (hold for push-to-talk or tap for toggle mode), say what you want, and the text lands wherever your cursor is.
- **Stays on your device** — transcription runs locally with ONNX models; nothing leaves your computer unless you choose a cloud provider.
- **Pick your microphone** — choose a specific input device, or let the system default handle it.
- **Cleans up as it goes** — optional AI step reformats and polishes the transcript (multiple saved agent profiles, e.g. Email / Code / Formal), plus silence trimming so filler pauses don't get transcribed.
- **Your words, your way** — custom vocabulary turns shortcuts into proper terms (say "gpt", get "GPT").
- **Look back** — searchable history lets you replay the recording, re-transcribe, or edit any past dictation, and shows how much typing time you've saved.
- **Out of the way** — lives in the system tray; close the window and it keeps running, ready for the next hotkey.
- **Updates itself** — checks GitHub releases and installs new versions in-app.

## How it works

```
Speak → Record → Transcribe → [Refine] → Insert
```

You speak, Wisper records locally, transcribes your voice to text, optionally refines it with an AI model, then types it at your cursor or copies it to the clipboard.

## Requirements

Wisper inserts text by simulating a paste/keystroke into whatever app is focused. How well this works depends on your display server and which paste helper is installed:

- **ydotool (recommended on Wayland)** — injects keystrokes through a kernel `uinput` virtual device, so it works on **both X11 and Wayland with no permission prompt**. It needs the `ydotoold` daemon running and your user in the `input` group.
- **wtype** — a zero-config Wayland tool, but it only works on compositors that implement the Wayland `virtual-keyboard` protocol. On compositors that don't (you'll see `Compositor does not support the virtual keyboard protocol`), wtype fails entirely.
- **enigo** — types fast, but on native Wayland it goes through the desktop **RemoteDesktop portal**, so the system pops a **"remote desktop / input capture" permission prompt** (usually one-time if you let the compositor remember it).

### Setting up ydotool (no prompts)

```bash
# 1. Install
# Debian / Ubuntu
sudo apt install ydotool
# Fedora
sudo dnf install ydotool
# Arch
sudo pacman -S ydotool

# 2. Start the daemon (and enable it to run at login)
sudo systemctl enable --now ydotoold.service
#   ...or, if your distro ships it as a user service:
# systemctl --user enable --now ydotoold.service

# 3. Let your user inject input (uinput needs the input group)
sudo usermod -aG input $USER
# then log out and back in for the group to apply
```

After that, set **General → Output → Paste Tool** to `ydotool` (or leave it on `auto` — Wisper prefers ydotool when both helpers are present, since it pastes without prompting). Verify with:

```bash
ydotool type "hello world"   # should print "hello world" into the focused window, exit 0
```

### About the RemoteDesktop portal prompt (enigo / wtype)

On Wayland, `enigo` and `wtype` ask the compositor for permission to inject input, which surfaces as a **"remote desktop" / "remote control"** dialog. This is expected — grant it and tick **remember** so it isn't re-asked. `ydotool` avoids this entirely because it uses `uinput` below the compositor.

By default Wisper auto-detects the best available tool, but you can pick a specific one under **General → Output → Paste Tool**. The app also shows a warning there if you're on Wayland without a suitable tool installed.

> **Why does it ask for remote desktop permission?** When you use the **built-in** paste tool on Wayland, Wisper has no direct way to type into other apps, so it routes input through the XDG Desktop Portal's RemoteDesktop interface — the same mechanism screen-sharing tools use — which requires your consent. This is a Wayland limitation, not a bug. Installing `wtype` or `ydotool` avoids the portal (and the prompt) entirely, since they inject input through dedicated channels.

> **Note:** If you install the `.deb` or `.rpm` package, these tools may be pulled in automatically. AppImage users should install them manually as shown above.

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Tauri v2 (Rust)
- **STT:** local ONNX models + optional cloud APIs
- **Platform:** Linux (X11 and Wayland), distributed as an AppImage

## Development

Prerequisites: [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/), and [pnpm](https://pnpm.io/), plus the [Tauri Linux system dependencies](https://tauri.app/start/prerequisites/).

```bash
# install JS dependencies
pnpm install

# run the app in development
pnpm tauri dev

# build a production bundle (AppImage)
pnpm tauri build
```

## Releases & Auto-update

Wisper checks the latest GitHub release and can download and install updates from within the app. Update artifacts are signed; the private signing key is kept out of the repository and supplied via environment variables at build time.

## License

See the repository for license details.
