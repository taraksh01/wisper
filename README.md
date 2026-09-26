# Wisper

Talk instead of type. Press one key, say what you mean, and the words show up in whatever app you were already using. By default everything runs on your own computer.

Works on **Linux, Windows, and macOS**. Free and open source (MIT), no account, no telemetry.

## Install

| Platform | Download | Notes |
| --- | --- | --- |
| **Linux** | `.deb`, `.rpm`, or `.AppImage` | Pick the one your distro uses. On Wayland, see [Linux notes](#linux-notes). |
| **Windows** | `-setup.exe` | Standard installer. |
| **macOS** | `.dmg` for Apple Silicon or Intel | macOS 13 or newer. Unsigned, so right-click then Open the first time. |

Get the files from the [latest release](https://github.com/taraksh01/wisper/releases/latest), or from the [website](https://taraksh01.github.io/wisper/).

### Linux notes

On X11, everything works with no extra setup.

On **Wayland** (GNOME, KDE, Hyprland, Sway, and friends), apps are not allowed to type into each other freely, so Wisper needs a small helper to paste your text:

- **Nothing to do** on most desktops. Wisper asks for a one-time "remote desktop" permission the first time it pastes, then stops asking.
- **Optional, recommended:** [`ydotool`](docs/ydotool-setup.md). It needs no permission prompt and types noticeably faster.
- **GNOME users:** Wisper installs a tiny companion extension the first time you run it so it can return to the app you started in. You will need to log out and back in once. Details in [docs/WAYLAND-PASTE.md](docs/WAYLAND-PASTE.md).

### Windows notes

If the microphone level meter in General stays flat, Windows is blocking recording. Open **Settings → Privacy → Microphone** and allow desktop apps to use the microphone.

### macOS notes

macOS asks for two permissions:

- **Microphone.** Without it, recording captures silence.
- **Accessibility.** Without it, the hotkey does nothing and nothing pastes.

If the hotkey ever stops working after an update, remove Wisper with the minus button in **System Settings → Privacy & Security → Accessibility**, then add it again with plus.

## Getting started

1. **Pick an engine.** Open **Engine** and choose how speech becomes text. Wisper ships with 20 local models across six families (Whisper, Parakeet, IndicConformer, Moonshine, SenseVoice, Qwen3) that run on your own machine, from a 56 MB English model to a 2.45 GB model covering 22 Indian languages. You can also use a cloud provider (OpenAI, Groq, Sarvam, or any OpenAI-compatible endpoint) if you prefer. Nothing transcribes until one is active.
2. **Choose a microphone** in **General** and check the level meter.
3. **Press the hotkey** (F9 by default) and talk. Release to insert the text, or tap once for toggle mode.

While you talk, a small pill shows your voice level and the app you started in. When it finishes, the text is inserted right where you began.

Want the text tidied up afterwards (punctuation, filler words, formatted for email or code)? Turn on the optional AI step in **Process**.

## What else it does

- **Inserts where you started.** Click somewhere else mid-sentence and it still goes back to the original app. The pill shows that app's icon.
- **Works offline.** No key and no network needed. Cloud is opt-in, and keys stay on your device.
- **Cloud keys that fail over.** Add several keys per provider and Wisper rotates to the next one when one hits a rate limit.
- **Your vocabulary.** Teach it your terms once (say "gpt", get "GPT"). Four ready-made profiles, or make your own and share them by URL.
- **History you can fix.** Search past dictations, replay the audio, re-run them with a different model, or edit the text.
- **Sounds for each step.** Optional audio cues when recording starts and when text is ready.
- **Your languages.** Auto-detect, or set the order you prefer for bilingual speech.
- **Quiet by default.** Sits in the system tray, can start with your system, and updates itself.

## If something goes wrong

- **Microphone meter stays flat:** see [Windows notes](#windows-notes) or [macOS notes](#macos-notes).
- **Hotkey does nothing:** check Accessibility on macOS. On Linux Wayland, see [docs/WAYLAND-PASTE.md](docs/WAYLAND-PASTE.md).
- **Typing feels slow on Linux:** your `ydotool` is likely older than 1.0.4. See [docs/ydotool-setup.md](docs/ydotool-setup.md).
- **Text lands in the wrong app:** browser tabs share a single window, so Wisper can return to the right window but not the exact tab.
- **More questions:** the [FAQ on the website](https://taraksh01.github.io/wisper/#faq).

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to build and run it locally.

## License

MIT. See [LICENSE](LICENSE).
