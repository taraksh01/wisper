# Wisper

Turn your voice into text right on your device, with your privacy always in your hands. Just speak, and your words are ready to paste anywhere. Everything stays on your computer by default, with optional cloud providers available whenever you choose to use them.

Wisper is a lightweight, privacy-first desktop dictation app for Linux. Press a global hotkey, speak, and the transcribed text is inserted wherever your cursor is. An optional AI step can clean up and format the result before it lands.

## Features

- **Push-to-talk dictation** — hold a global hotkey, speak, release.
- **Local-first speech-to-text** — runs on-device with ONNX models; nothing leaves your machine unless you opt in.
- **Optional cloud providers** — use OpenAI, Groq, or a custom endpoint for transcription when you want.
- **Optional AI refinement** — post-process transcriptions with an LLM (OpenAI, Anthropic, Google, Groq, OpenRouter, and more) using a configurable Smart Agent.
- **Flexible paste** — insert text at the cursor via direct typing or the clipboard.
- **History** — browse, replay, re-transcribe, and manage past dictations.
- **Auto-update** — checks GitHub releases and installs new versions in-app.
- **Lives in the tray** — quick access, unobtrusive, always ready.

## How it works

```
Speak → Record → Transcribe → [Refine] → Insert
```

You speak, Wisper records locally, transcribes your voice to text, optionally refines it with an AI model, then types it at your cursor or copies it to the clipboard.

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
