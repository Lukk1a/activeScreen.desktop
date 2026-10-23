# ActiveScreen 🖥️

An Equicord / Vencord desktop plugin that automatically and dynamically switches your Discord Go Live screen share to the monitor containing your cursor.

---

## ✨ Features

- **Automatic Cursor-Following:** Effortlessly switches screens as you move your mouse between monitors.
- **Seamless Stream Swapping:** Updates Discord's active Go Live video feed in-place without renegotiating the WebRTC connection or dropping your voice call.
- **Configurable Dwell Time:** Set a custom delay (default: 1000ms) to prevent unwanted switches when quickly flicking your cursor across displays.
- **WebRTC Cooldown Guard:** Protects against encoder thrashing and stream black-screens with an internal 1500ms safety cooldown.
- **User Panel Toggle Button:** Adds a native-styled monitor icon next to Mute/Deafen in Discord's bottom panel. Visually indicates when ActiveScreen is paused with a red strike and red indicator glow.
- **Interactive Shortcut Recorder:** Record any custom keyboard combination (default: `Ctrl+Shift+S`) directly inside plugin settings.
- **Stream Quality & Audio Preservation:** Maintains your stream resolution (720p/1080p/1440p/4K), framerate (30/60fps), system soundshare, and stream preview privacy settings across screen swaps.
- **Window Stream Immunity:** Ignores window/game shares (e.g. Counter-Strike, Chrome) so your game streams are never hijacked.
- **Resource Optimized:** Only monitors cursor coordinates when actively streaming a screen (0% idle CPU overhead).

---

## 📦 Installation

### Method 1: Via UserpluginInstaller (Recommended)
1. In Discord, go to **User Settings** (`⚙`) $\to$ **Plugins** $\to$ make sure **UserpluginInstaller** is enabled.
2. In the UserpluginInstaller tab, paste this repository URL:
   ```
   https://github.com/Lukk1a/activeScreen.desktop
   ```
3. Click **Install / Clone** and restart or reload Discord (<kbd>Ctrl</kbd> + <kbd>R</kbd>).

---

### Method 2: Manual Git Clone
1. Open a terminal in your Equicord or Vencord source directory.
2. Clone this repository directly into `src/userplugins/activeScreen.desktop`:
   ```bash
   git clone https://github.com/Lukk1a/activeScreen.desktop src/userplugins/activeScreen.desktop
   ```
3. Rebuild your client mod:
   ```bash
   pnpm build
   ```
4. Reload Discord (<kbd>Ctrl</kbd> + <kbd>R</kbd>).

---

## ⚙️ Configuration

Open **User Settings** (`⚙`) $\to$ **Plugins** $\to$ **ActiveScreen**:

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **autoSwitch** | Toggle | `true` | Turn automatic monitor-following on or off. |
| **showButton** | Toggle | `true` | Show the quick-toggle button next to Mute/Deafen. |
| **showToast** | Toggle | `true` | Show pop-up toast notifications when toggling. |
| **delay** | Slider | `1000ms` | Dwell time required on a new monitor before switching. |
| **onlyWhenStreamingScreen** | Toggle | `true` | Only switch when sharing an entire display, not a specific app window. |
| **shortcut** | Key Recorder | `Ctrl+Shift+S` | Click the button and press any key combination to record your custom shortcut. |

---

## 👤 Author

Developed by **[l1uka1](https://github.com/Lukk1a)** (Discord ID: `998585779804708864`).

---

## 📄 License

GPL-3.0-or-later — see [LICENSE](LICENSE) for details.
