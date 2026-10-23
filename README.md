# ActiveScreen

An Equicord and Vencord desktop plugin that automatically switches your screen share to the monitor containing your cursor.

## Features

- **Cursor-following:** Switches screens dynamically as your cursor moves between displays.
- **Seamless swapping:** Updates the stream source in-place without renegotiating the WebRTC call.
- **Configurable dwell time:** Dwell delay prevents accidental switches during fast mouse flicks.
- **WebRTC protection:** Built-in cooldown prevents stream stutter and encoder thrashing.
- **Panel toggle button:** Adds a toggle button next to Mute/Deafen in the user panel.
- **Interactive keybind recorder:** Record any custom shortcut directly in settings (default: `Ctrl+Shift+S`).
- **Quality & audio preservation:** Preserves resolution, framerate, system audio, and preview settings.
- **Window share immunity:** Only switches when sharing a full screen, never interfering with window shares.

## Installation

### Via UserpluginInstaller

1. Open Discord Settings -> Plugins and ensure UserpluginInstaller is enabled.
2. In the UserpluginInstaller tab, paste:
   ```
   https://github.com/Lukk1a/activeScreen.desktop
   ```
3. Install and reload Discord (`Ctrl+R`).

### Manual Clone

```bash
git clone https://github.com/Lukk1a/activeScreen.desktop src/userplugins/activeScreen.desktop
pnpm build
```

## Settings

- **autoSwitch:** Enable or disable automatic screen switching.
- **showButton:** Show toggle button next to mute/deafen.
- **showToast:** Show notifications when toggled.
- **delay:** Dwell time before switching screens (default: 1000ms).
- **onlyWhenStreamingScreen:** Only switch when sharing a full display.
- **shortcut:** Customizable shortcut to toggle the plugin.

## Author

- l1uka1 (Discord ID: `998585779804708864`)

## License

GPL-3.0-or-later
