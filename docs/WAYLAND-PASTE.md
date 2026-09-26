# Pasting on Linux, and back where you started

This guide is for Linux users, especially on Wayland. It covers two things: how Wisper gets text into another app, and how it returns to the app you started dictating in.

For installing `ydotool` itself, see [ydotool-setup.md](ydotool-setup.md).

## Why Wayland needs a helper

On X11, any app can type into any other app. On Wayland, that is deliberately restricted, so Wisper has to ask the desktop for permission or use a helper that types below the compositor. There are three options, and Wisper picks the best one available:

| Option | Install | Permission prompt | Speed | Notes |
| --- | --- | --- | --- | --- |
| **Built-in** | none | one-time "remote desktop" dialog on Wayland | fast | Works everywhere. Grants are remembered by the desktop. |
| **wtype** | `sudo apt install wtype` | one-time prompt | fast | Only on desktops that support the Wayland virtual keyboard protocol. |
| **ydotool** | see [ydotool-setup.md](ydotool-setup.md) | none | fastest | Best on Wayland. Needs 1.0.4 or newer. |

On X11, Wisper simply types directly and none of this applies.

You can override the choice under **General → Output → Paste Tool**. Wisper also shows a warning there if you are on Wayland with nothing suitable installed. **Test paste** in the same section confirms the whole path works before you rely on it.

## Back where you started

Wisper remembers the window where you pressed the hotkey and returns there before inserting text, so clicking elsewhere mid-sentence does not lose your place. The recording pill shows that app's icon (its first letter if the icon cannot be read).

Check the status any time under **General → Output → Paste back to where you started**.

If the original window was closed, Wisper does not guess: it skips the paste, leaves your clipboard alone, and saves the text to history with an error message.

### GNOME on Wayland

GNOME isolates apps more than most desktops, so Wisper bundles a small companion extension, "Wisper Focus", that only exposes the window list and lets Wisper focus a window. It does not read window contents, does not send keystrokes, does not use the network, and needs no root.

On first run (GNOME and Wayland only), Wisper copies the extension into your user profile, enables it, and shows the status in General. **The first time needs one logout and login** before GNOME activates it. Until then, Wisper pastes wherever your cursor currently is. If it looks inactive, use **Install helper / Recheck** in General.

Verify or turn it off from a terminal:

```bash
gnome-extensions show wisper-focus@wisper.app
gnome-extensions disable wisper-focus@wisper.app   # paste falls back to current focus
```

Its source lives in `src-tauri/resources/gnome-shell/wisper-focus@wisper.app/`.

### Other desktops

X11, KDE, Hyprland, and Sway work out of the box with no helper. If focus detection ever fails there, Wisper pastes at your current focus instead of erroring.

### One limitation worth knowing

Browser tabs share a single window. Wisper can bring you back to the right browser window, but the text goes into whichever tab happens to be active at that moment. Switch to the tab you want before dictating if that matters.

## Common problems

| What you see | Why | Fix |
| --- | --- | --- |
| "Compositor does not support the virtual keyboard protocol" | `wtype` cannot work on this desktop | Install `ydotool` instead |
| Remote desktop prompt keeps appearing | The built-in tool is being used and the desktop is not remembering the grant | Install `ydotool`, or allow and remember the prompt |
| Typing is very slow (around 2 seconds per 100 characters) | `ydotool` is older than 1.0.4 and ignores the timing flags | Upgrade to 1.0.4 or newer |
| Permission denied or `uinput` error | Your user is not in the `input` group | See [ydotool-setup.md](ydotool-setup.md) |
| Pastes in the wrong place on GNOME Wayland | The helper extension is not active yet | Log out and back in once, then Recheck in General |
