# Contributing to Wisper

Thanks for helping out. This guide covers local development, code layout, conventions, and how releases are cut. For installing and using the app, see [README.md](README.md).

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) 24
- [pnpm](https://pnpm.io/) 12
- Linux: the [Tauri system dependencies](https://tauri.app/start/prerequisites/) (`libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libasound2-dev`, `libayatana-appindicator3-dev`, `patchelf`, `rpm`)
- macOS: Xcode Command Line Tools (`xcode-select --install`) instead of the Linux packages

## Get it running

```bash
pnpm install          # JS dependencies
pnpm tauri:dev        # run the app in dev mode
pnpm dev              # frontend only, in a browser
```

`pnpm tauri:dev` starts **Wisper Dev**, a separate app that runs alongside your installed Wisper with its own settings, history, and tray icon (violet instead of orange), so you never clobber your daily driver. See [Dev vs prod flavours](#dev-vs-prod-flavours).

## Build and test

```bash
pnpm build            # type check + production frontend bundle
pnpm tauri:build      # full desktop bundle (alias: pnpm tauri build)

cd src-tauri
cargo check           # compile everything, including tests
cargo test            # unit tests
cargo fmt             # format (please run before committing)
```

Target counts: `cargo test` runs the library unit tests (engine error classification, audio trimming, dictionary profiles, coordinator state, and so on), and `pnpm build` runs `tsc` plus the Vite build. Both must be clean, with no warnings, before you open a PR.

Platform notes for local testing:

- **Linux Wayland:** paste testing needs [`ydotool`](docs/ydotool-setup.md) 1.0.4 or newer. Older versions type very slowly because they ignore the timing flags Wisper passes.
- **macOS Intel:** the ONNX Runtime has no official x86_64 macOS build, so a community build is used and injected at bundle time. `scripts/setup-ort-intel-mac.sh` sets that up locally.
- **Cloud paths:** `scripts/test_process_*.mjs` exercise the optional AI cleanup against live providers. They are manual, not part of `cargo test`.

## Code layout

```
src/                     React frontend
  components/            one file per settings tab or shared UI piece
  types.ts               settings shape, model catalog, language lists
  appConfig.ts           dev vs prod app identity and paths
src-tauri/src/           Rust backend, one module per concern
  coordinator.rs         dictation state machine, cloud key rotation
  engine.rs              transcription trait, local and cloud engines
  models.rs              model download, extraction, validation
  audio.rs               capture, levels, silence trimming
  paste.rs               paste backends (built-in, wtype, ydotool) and Wayland origin window
  focus.rs               origin window tracking
  process.rs             optional AI cleanup
  settings.rs            persisted settings and migrations
  history.rs, words.rs, dictionary.rs   SQLite storage
  tray.rs, hotkey.rs, app_info.rs       tray menu, global hotkey, version info
  resources/gnome-shell/  the GNOME "Wisper Focus" extension
docs/                    the public website (GitHub Pages), plus user guides
```

## Conventions

- Conventional commits, one concern per commit: `feat(ui):`, `fix(backend):`, `docs:`, `ci(release):`, `chore:`. Look at `git log` for the tone.
- Do not mix a refactor with a behavior change in the same commit.
- Keep user-facing copy free of jargon. If a setting needs a technical explanation, put it in the app copy or a guide, not in a commit message.
- `docs/` is a live website. Changes there affect what visitors see, and `docs/ydotool-setup.md` plus `docs/WAYLAND-PASTE.md` are also linked from the README.

## Releasing

1. Bump the version in four files so they all match: `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
2. Commit that bump on the release branch.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The [release workflow](.github/workflows/release.yml) guards on step 1: the build fails unless all three version sources agree and the tag matches. For a stable tag it builds Linux (AppImage, deb, rpm), Windows (NSIS), and macOS (Apple Silicon and Intel) into a single draft release with a signed updater feed. Beta tags build macOS only and publish to a rolling beta feed.

After the draft release is published, the website's download cards pick up the new assets automatically on the next page load.

## Reporting bugs

Include your OS and version, what you expected, what happened, and the relevant part of General or Engine settings. If it involves dictation, a short note about your microphone and model makes reproduction much faster.
