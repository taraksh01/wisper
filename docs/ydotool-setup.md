# ydotool Setup Guide — Wisper

Wisper inserts text by simulating keystrokes into the focused app. On Linux, the most reliable way is **ydotool** via the kernel `uinput` device — it works on both X11 and Wayland **without a permission prompt** and is the fastest option for direct typing.

This guide covers installing **ydotool ≥1.0.4** (required), starting its daemon, and verifying it. For a quick overview, see `README.md#requirements`.

## Why 1.0.4?

Wisper's direct-typing path is tuned for speed:

- `ydotool type -d 0 -H 0` (delay 0, hold 0)
- `wtype -d 0`
- `enigo` with `linux_delay: 0`

Versions before **1.0.4** ignore or reject `-H`/`-d 0` and fall back to the defaults `20 ms` hold + `20 ms` delay — **≈2 s per 100 chars vs ≈50 ms** with 1.0.4. Older distro packages (e.g. Ubuntu 22.04 ships `0.x`) are too old. Ubuntu 26.04 ships `1.0.4-3`, which is the current upstream latest (`v1.0.4`).

Check yours:

```bash
apt-cache policy ydotool   # Debian/Ubuntu — expect 1.0.4
ydotool help               # shows available commands
```

Upstream: https://github.com/ReimuNotMoe/ydotool (latest tag `v1.0.4`).

## Install — prefer 1.0.4+

### Arch (usually has 1.0.4)

```bash
sudo pacman -S ydotool
```

### Fedora (recent)

```bash
sudo dnf install ydotool
```

### Debian / Ubuntu — distro repo is often outdated

If `apt-cache policy ydotool` shows `<1.0.4`, build from source:

```bash
# dependencies
sudo apt update
sudo apt install git cmake scdoc pkg-config libevdev-dev libuinput-dev

# build 1.0.4
git clone https://github.com/ReimuNotMoe/ydotool
cd ydotool
mkdir build && cd build
cmake ..
make -j$(nproc)
sudo make install
# binary is /usr/local/bin/ydotool — ensure it’s on PATH
```

More: https://github.com/ReimuNotMoe/ydotool#building-from-source

## Start the daemon

ydotool needs `ydotoold` running:

```bash
# system-wide (most installs)
sudo systemctl enable --now ydotoold.service

# if your distro ships a user service instead
systemctl --user enable --now ydotoold.service

# check
systemctl status ydotoold.service
# or
systemctl --user status ydotoold.service
```

If the service name differs (`ydotool.service` on some AUR builds), use that.

## Add your user to the `input` group

`uinput` requires it:

```bash
sudo usermod -aG input $USER
# log out and back in for the group to apply
groups   # should now list "input"
```

## Verify — should be ≥1.0.4 and exit 0

```bash
apt-cache policy ydotool | grep Installed   # expect 1.0.4
# or
ydotool help | head -5

# focus any text field, then:
ydotool type -d 0 -H 0 "hello world"   # should appear instantly
echo $?  # 0 = success
```

If you see `Unknown option -H` or it types very slowly, you’re on `<1.0.4`.

## Configure Wisper

1. Open **General → Output → Paste Tool**
2. Pick `ydotool` (or leave `auto` — Wisper prefers ydotool when both helpers are present)
3. The app shows a warning on Wayland if no suitable tool is installed.

No portal prompt is needed for ydotool (it uses `uinput` below the compositor).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Compositor does not support the virtual keyboard protocol` | `wtype` on unsupported compositor | Use `ydotool` instead |
| `Failed to run ydotool type` / `No such file` | `ydotoold` not running | `systemctl enable --now ydotoold` |
| `Permission denied` / `uinput` error | Not in `input` group | `usermod -aG input $USER` + relogin |
| Typing is slow (≈2 s/100 chars) | `ydotool <1.0.4` (ignores `-H 0`) | Upgrade to `1.0.4` (build from source) |
| RemoteDesktop prompt still appears | Using `enigo` fallback on Wayland | Install `ydotool`/`wtype` to avoid portal |

## Alternatives (if you can’t use ydotool)

- **wtype** — zero-config Wayland tool, needs `virtual-keyboard` protocol. Install: `sudo apt install wtype` / `sudo dnf install wtype` / `sudo pacman -S wtype`. No daemon/group needed, but fails on some compositors.
- **enigo** — built into Wisper, no install. On Wayland it uses the `RemoteDesktop` portal → one-time permission dialog (tick “remember”).

AppImage users: the `.deb`/`.rpm` may pull `ydotool` automatically; AppImage users install it manually as above.
