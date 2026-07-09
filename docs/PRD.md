# v3 — Product Requirements Document (PRD)

**Version**: 1.0
**Date**: 2026-07-09
**Status**: Active
**Platform**: Linux (Ubuntu 26.04 primary, AppImage for all distros)
**Tech Stack**: Tauri v2 (Rust backend) + React/TypeScript frontend

---

## 1. Product Overview

v3 is a lightweight, privacy-first desktop voice dictation application for Linux. Users press a global hotkey, speak naturally, and the transcribed text is instantly pasted into whatever application they are currently using. An optional LLM post-processing step intelligently formats the raw transcription based on context (email, code, chat, etc.) using a fully configurable "Smart Agent" harness.

### Core Value Propositions

1. **Speed**: Transcribe and paste in under 2 seconds for short phrases.
2. **Privacy**: Local Whisper models run entirely on-device. No audio leaves the machine unless the user explicitly configures a cloud provider.
3. **Flexibility**: Every component (STT model, LLM, hotkey, paste method) is user-configurable.
4. **Linux-First**: Built specifically for Linux desktops, supporting both X11 and Wayland compositors.

---

## 2. Target Users

- Linux power users and developers who want fast voice-to-text input.
- Privacy-conscious users who refuse to send audio to the cloud.
- Users with RSI or accessibility needs who prefer voice over typing.
- Developers who want to dictate code comments, commit messages, or documentation.

---

## 3. Competitive Landscape

| App | Linux | Local STT | Cloud STT | LLM Post-Processing | Open Source | Price |
|-----|-------|-----------|-----------|---------------------|-------------|-------|
| Wispr Flow | No | No | Yes | Yes (built-in) | No | $12/mo |
| VoiceTypr | No | Yes | Yes (BYO) | Yes (BYO key) | No | $39-99 |
| Handy | Yes | Yes | No | Yes (BYO key) | Yes (MIT) | Free |
| nerd-dictation | Yes | Yes (VOSK) | No | No | Yes (GPL-3) | Free |
| WhisperWriter | Yes | Yes | Yes | No | Yes (GPL-3) | Free |
| **v3 (ours)** | **Yes** | **Yes** | **Yes** | **Yes (BYO key)** | **Yes** | **Free** |

**Our differentiation**: Linux-first, configurable Smart Agent LLM harness with user-defined prompts, both local and cloud STT with configurable endpoints, lightweight Tauri build.

---

## 4. Feature Specification

### 4.1 Speech-to-Text Engine (Configurable)

#### Local Mode (Default)
- Embed `whisper.cpp` via Rust bindings for fully offline transcription.
- Ship with ability to download Whisper GGML models (tiny, base, small, medium, large).
- GPU acceleration via Vulkan where available, CPU fallback.

#### Cloud Mode (Optional)
- HTTP client to any OpenAI-compatible `/v1/audio/transcriptions` endpoint.
- Configurable: Base URL, API Key, Model name.
- Compatible with: OpenAI Whisper API, Groq, Deepgram, self-hosted endpoints.

### 4.2 Global Hotkey System

#### Push-to-Talk (Default)
- Hold the configured hotkey to record.
- Release to immediately stop recording and begin transcription.

#### Toggle Mode (Alternative)
- Press hotkey once to start recording.
- Press again to stop and transcribe.
- Ideal for longer dictation sessions.

#### Cancel
- A secondary hotkey to cancel an in-progress recording/transcription.

### 4.3 Fast Text Injection Engine

The transcribed (and optionally LLM-formatted) text must appear in the user's active application as fast as possible.

#### Pipeline
1. Snapshot the user's current clipboard contents.
2. Write the transcription to the clipboard.
3. Simulate a paste keystroke (`Ctrl+V`, `Shift+Insert`, or `Ctrl+Shift+V`).
4. Restore the original clipboard contents after a short delay (~200ms).

#### Display Server Detection
- Auto-detect X11 vs Wayland at runtime via `XDG_SESSION_TYPE` / `WAYLAND_DISPLAY`.
- **X11**: Use `xdotool` or `enigo` for keystroke simulation.
- **Wayland**: Use `wtype` (primary), `ydotool` or `dotool` (fallbacks).

#### Paste Methods (User-Configurable)
- `Ctrl+V` (default)
- `Ctrl+Shift+V` (for terminals, paste without formatting)
- `Shift+Insert` (legacy/universal)
- Direct keystroke typing (no clipboard, character-by-character)
- None (copy to clipboard only, user pastes manually)

### 4.4 Smart Agent LLM Harness

#### Core Concept
After transcription, the raw text is optionally sent to an LLM for intelligent formatting. The user controls:
- **Whether to use LLM at all** (toggle on/off in settings).
- **Which LLM provider** (Base URL, API Key, Model — any OpenAI-compatible endpoint).
- **What the LLM does** via configurable System Prompts ("Smart Agents").

#### Smart Agent Profiles (User-Definable)
Users can create, edit, delete, and select from multiple Smart Agent profiles. Each profile has:
- A **name** (e.g., "Email Formatter", "Code Comment", "Casual Cleanup").
- A **system prompt** that instructs the LLM how to transform the text.
- An **active/default** flag.

#### Built-in Default Profile ("Auto-Format")
A pre-configured Smart Agent that dynamically adapts:
- Short text with casual language → Clean up filler words, keep casual tone.
- Long formal text → Format as email with greeting, paragraphs, and sign-off.
- Text with technical/dev keywords → Preserve technical terms, format as code comment or documentation.
- General speech → Fix grammar, remove filler words ("um", "uh", "like"), maintain original intent.

#### LLM Configuration (Settings UI)
- **Enable/Disable** toggle.
- **Base URL** — e.g., `https://api.openai.com/v1`, `http://localhost:11434/v1` (Ollama), etc.
- **API Key** — stored securely on disk.
- **Model** — e.g., `gpt-4o-mini`, `llama3`, etc.
- **Smart Agent selector** — dropdown to pick the active prompt profile.
- **Prompt editor** — full text editor for the system prompt.

### 4.5 Transcription History & Analytics

#### History Storage
- SQLite database in the app's data directory.
- Each entry stores:
  - Timestamp.
  - Raw transcription text.
  - LLM-processed text (if applicable).
  - Smart Agent profile used.
  - Audio duration.
  - Word count.

#### History UI
- Searchable list of past transcriptions.
- Filter by date range.
- Click-to-copy any past transcription.
- Delete individual entries or clear all.

#### Usage Analytics
- Total transcriptions (all-time, this week, today).
- Total words dictated.
- Average transcription length.
- Most-used Smart Agent profile.

### 4.6 Settings UI

A React-based settings window accessible from the system tray icon.

#### Sections
1. **STT Settings**: Provider toggle (Local/Cloud), model selector, cloud Base URL, API Key, language.
2. **LLM Settings**: Enable/disable, Base URL, API Key, model, Smart Agent profile manager.
3. **Hotkey Settings**: Push-to-talk key binding, toggle mode key binding, cancel key binding, mode selector (push-to-talk vs toggle).
4. **Paste Settings**: Paste method selector, paste delay configuration, clipboard restore toggle.
5. **Audio Settings**: Microphone selector, VAD sensitivity.
6. **General**: Autostart on login, start hidden/minimized, theme (light/dark).

### 4.7 System Tray

- Persistent system tray icon indicating app state:
  - **Idle** — default icon.
  - **Recording** — animated/highlighted icon.
  - **Processing** — spinner or pulsing icon.
- Context menu: Settings, History, Copy Last Transcription, Quit.

---

## 5. Non-Functional Requirements

- **Startup time**: < 2 seconds to system tray.
- **Transcription latency** (local, base model): < 3 seconds for a 10-second recording.
- **Memory usage**: < 200 MB idle (excluding loaded Whisper model).
- **AppImage size**: < 50 MB (without bundled Whisper models).
- **Models downloaded on demand**: Not bundled in the AppImage.

---

## 6. Technical Architecture

```
┌──────────────────────────────────────────────────┐
│                  System Tray                      │
│           (Tauri tray-icon API)                   │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│              Tauri v2 Core                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Hotkey   │ │ Audio    │ │ Transcription    │  │
│  │ Manager  │ │ Manager  │ │ Coordinator      │  │
│  │ (rdev)   │ │ (cpal)   │ │ (state machine)  │  │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
│       │            │                │             │
│  ┌────▼────────────▼────────────────▼──────────┐  │
│  │           Action Pipeline                    │  │
│  │  Record → Transcribe → LLM Format → Paste   │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ STT      │ │ LLM      │ │ Clipboard/Paste  │  │
│  │ Engine   │ │ Client   │ │ Engine           │  │
│  │(whisper/ │ │(reqwest) │ │(enigo/wtype/     │  │
│  │ cloud)   │ │          │ │ xdotool)         │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
│                                                   │
│  ┌──────────┐ ┌──────────────────────────────┐   │
│  │ History  │ │ Settings Store               │   │
│  │ Manager  │ │ (tauri-plugin-store)         │   │
│  │(rusqlite)│ │                              │   │
│  └──────────┘ └──────────────────────────────┘   │
└──────────────────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│            React Frontend (WebView)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Settings │ │ History  │ │ Smart Agent      │  │
│  │ Panel    │ │ Viewer   │ │ Editor           │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Key Rust Crates

| Crate | Purpose |
|-------|---------|
| `tauri` 2.x | App framework, window management, IPC, tray, plugins |
| `cpal` | Cross-platform audio capture |
| `whisper-rs` | Rust bindings for whisper.cpp (local STT) |
| `rdev` | Global keyboard event capture |
| `enigo` | Cross-platform keyboard/mouse simulation |
| `reqwest` | HTTP client (cloud STT, LLM API calls) |
| `rusqlite` | SQLite database (history storage) |
| `serde` / `serde_json` | Serialization |
| `chrono` | Timestamps |
| `arboard` | Cross-platform clipboard access |

### Frontend Stack

| Package | Purpose |
|---------|---------|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool |
| Tailwind CSS | Styling |
| Zustand | State management |
| `@tauri-apps/api` | Frontend-backend IPC |

---

## 7. Implementation Phases & Task Breakdown

### Phase 1: Project Scaffolding & System Tray Daemon

> **Goal**: A running Tauri v2 app with a system tray icon, a basic React window, and Git initialized.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 1.1 | Initialize Git repository | `pending` | `git init`, `.gitignore`, initial commit |
| 1.2 | Scaffold Tauri v2 project | `pending` | `bun create tauri-app` with React + TypeScript template |
| 1.3 | Configure Tailwind CSS | `pending` | Install and configure Tailwind CSS v4 |
| 1.4 | Implement system tray icon | `pending` | Create tray icon with context menu (Settings, Quit) |
| 1.5 | Window lifecycle management | `pending` | Close button hides to tray instead of quitting |
| 1.6 | Verify & commit Phase 1 | `pending` | Test tray icon, window hide/show, commit |

---

### Phase 2: Audio Recording & Global Hotkeys

> **Goal**: User can press a global hotkey to start/stop recording audio from the microphone.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 2.1 | Audio recording module | `completed` | Implement mic capture via `cpal` with configurable device selection |
| 2.2 | Voice Activity Detection | `completed` | Integrate Silero VAD or energy-based VAD to filter silence |
| 2.3 | Global hotkey listener | `completed` | Implement `rdev`-based global key capture for push-to-talk and toggle modes |
| 2.4 | Transcription coordinator | `completed` | State machine: `Idle → Recording → Processing → Idle` with event channel |
| 2.5 | Audio feedback | `completed` | Play subtle sound cue on recording start/stop |
| 2.6 | Tray icon state updates | `completed` | Update tray icon to reflect Idle/Recording/Processing states |
| 2.7 | Verify & commit Phase 2 | `completed` | Test hotkey → recording → state transitions, commit |

---

### Phase 3: Speech-to-Text Engine

> **Goal**: Recorded audio is transcribed into text using local Whisper or a cloud API.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 3.1 | Local STT with whisper-rs | `pending` | Integrate `whisper-rs` (whisper.cpp bindings) for local transcription |
| 3.2 | Model management | `pending` | Download, list, select, and delete Whisper GGML models |
| 3.3 | Cloud STT client | `pending` | HTTP client for OpenAI-compatible `/v1/audio/transcriptions` endpoint |
| 3.4 | STT provider abstraction | `pending` | Unified trait/interface so local and cloud are interchangeable |
| 3.5 | Wire STT into coordinator | `pending` | After recording stops, pass audio buffer to selected STT provider |
| 3.6 | Verify & commit Phase 3 | `pending` | Test local transcription end-to-end, commit |

---

### Phase 4: Fast Text Injection (Paste Engine)

> **Goal**: Transcribed text is instantly pasted into the user's active application.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 4.1 | Display server detection | `pending` | Runtime detection of X11 vs Wayland via env vars |
| 4.2 | Clipboard manager | `pending` | Save/restore clipboard contents using `arboard` or `wl-copy`/`xclip` |
| 4.3 | Keystroke simulation | `pending` | Paste via `enigo` (X11), `wtype` (Wayland), with fallback cascade |
| 4.4 | Configurable paste methods | `pending` | Support Ctrl+V, Ctrl+Shift+V, Shift+Insert, direct typing, none |
| 4.5 | End-to-end pipeline | `pending` | Hotkey → Record → Transcribe → Paste into active app |
| 4.6 | Verify & commit Phase 4 | `pending` | Test paste into various apps (terminal, browser, editor), commit |

---

### Phase 5: LLM Smart Agent Harness

> **Goal**: Optional LLM post-processing that formats transcription based on user-defined Smart Agent prompts.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 5.1 | LLM client module | `pending` | OpenAI-compatible chat completion client (`reqwest`) with configurable Base URL, API Key, Model |
| 5.2 | Smart Agent data model | `pending` | CRUD for prompt profiles: name, system prompt, active flag. Stored in settings |
| 5.3 | Default "Auto-Format" agent | `pending` | Built-in system prompt that dynamically adapts formatting based on content |
| 5.4 | LLM pipeline integration | `pending` | Insert LLM step between transcription and paste (when enabled) |
| 5.5 | Toggle LLM on/off | `pending` | Settings toggle + separate hotkey to transcribe with/without LLM |
| 5.6 | Verify & commit Phase 5 | `pending` | Test transcription → LLM formatting → paste, commit |

---

### Phase 6: History & Analytics

> **Goal**: All transcriptions are stored locally and viewable in a searchable history UI.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 6.1 | SQLite schema & migrations | `pending` | Create history table: id, timestamp, raw_text, formatted_text, agent_name, duration_ms, word_count |
| 6.2 | History manager (Rust) | `pending` | Insert, query, search, delete operations via `rusqlite` |
| 6.3 | History UI (React) | `pending` | Searchable list with date filters, click-to-copy, delete |
| 6.4 | Usage analytics | `pending` | Aggregate stats: total transcriptions, words, avg length, by-day chart |
| 6.5 | "Copy Last" tray action | `pending` | Tray menu item to copy the most recent transcription to clipboard |
| 6.6 | Verify & commit Phase 6 | `pending` | Test history persistence, search, analytics display, commit |

---

### Phase 7: Settings UI

> **Goal**: Full settings panel for configuring every aspect of the application.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 7.1 | Settings data model (Rust) | `pending` | `AppSettings` struct with serde serialization, stored via `tauri-plugin-store` |
| 7.2 | STT settings panel | `pending` | Provider toggle (Local/Cloud), model selector, Base URL, API Key, language |
| 7.3 | LLM settings panel | `pending` | Enable/disable, Base URL, API Key, Model, Smart Agent editor |
| 7.4 | Hotkey settings panel | `pending` | Key binding selector for push-to-talk, toggle, cancel. Mode selector |
| 7.5 | Paste settings panel | `pending` | Paste method dropdown, delay sliders, clipboard restore toggle |
| 7.6 | Audio settings panel | `pending` | Microphone selector dropdown |
| 7.7 | General settings panel | `pending` | Autostart, start hidden, theme toggle |
| 7.8 | Verify & commit Phase 7 | `pending` | Test all settings persist and apply correctly, commit |

---

### Phase 8: Packaging & Distribution

> **Goal**: Distributable AppImage for Linux.

| # | Subtask | Status | Description |
|---|---------|--------|-------------|
| 8.1 | Configure Tauri bundler | `pending` | Set up `tauri.conf.json` for Linux AppImage output |
| 8.2 | AppImage build & test | `pending` | Build AppImage, test on clean Ubuntu 26.04 |
| 8.3 | Runtime dependency check | `pending` | Ensure `wtype`, `xdotool`, etc. are detected at runtime with helpful error messages |
| 8.4 | First-run experience | `pending` | Guide user to download a Whisper model on first launch |
| 8.5 | Verify & commit Phase 8 | `pending` | Full end-to-end test of AppImage, commit + tag release |

---

## 8. Future Enhancements (Post-MVP)

These are explicitly **out of scope** for the initial build but noted for future iterations:

- Streaming/real-time transcription (show text as user speaks).
- Recording overlay (visual indicator on screen during recording).
- Per-application paste rules (different paste method per app).
- Multi-language support for UI.
- Auto-update mechanism.
- Whisper model fine-tuning support.
- macOS and Windows builds.
- Wake word activation ("Hey v3, ...").

---

## 9. Success Criteria

The MVP is complete when a user can:

1. Install the AppImage on Ubuntu 26.04.
2. Configure a global hotkey in settings.
3. Hold the hotkey (push-to-talk) to record speech.
4. See the transcribed text appear instantly in their active application.
5. Optionally enable LLM post-processing with their own API key.
6. Create custom Smart Agent prompts to control formatting.
7. View their transcription history and usage statistics.
8. Switch between local Whisper and cloud STT providers.

---

*This is a living document. Task statuses will be updated as implementation progresses.*
