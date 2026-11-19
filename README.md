# Maranatha 🎄✨

A cozy, lightweight desktop Christmas overlay utility built with Tauri, Rust, and React. Maranatha sits quietly on your taskbar bringing holiday cheer—complete with a Christmas countdown, string lights, snow, a fireplace, and a nativity scene—without getting in your way or cluttering your screen.

---

## 👥 For Non-Technical Users (How to Use It)

Want to add some holiday spirit to your computer without messing with any code or installers? Here is how to get running in under a minute:

### 1. How to Open the App
1. Download the latest `christmas-desktop.exe` file from the [Releases](https://github.com/Justin-Ebenazar/christmas-maranatha/releases) page.
2. Double-click the file. That’s it! No installation wizards, no setup menus, and no complicated steps. It opens instantly.

### 2. How to Control It (System Tray)
When the app runs, you won't see a window taking up space on your taskbar or Alt-Tab menu. Instead, it lives quietly in your **System Tray** (the small cluster of icons next to the clock, usually hidden behind the little upward arrow `^` at the bottom-right corner of your Windows taskbar):
* **Right-click the tree icon** in your tray to open the menu.
* Click **Settings** to open the configuration panel where you can tweak your overlay.
* Click **Quit Christmas** to close the app completely.

### 3. How to Uninstall (Remove It)
Because this is a portable app, it doesn't leave files scattered across your computer or modify your system settings:
* Simply **delete the `christmas-desktop.exe` file**. 
* (Optional) If you want to clear your saved settings completely, delete the `Maranatha` folder located under `C:\Users\YourUsername\AppData\Roaming\`.

---

## 🛠️ For Developers & Tech Enthusiasts

Maranatha is built for lightning-fast performance, low memory footprint, and native OS integration using a local-first stack.

### Tech Stack
* **Framework:** Tauri v2 (Rust backend for ultra-low resource usage)
* **Frontend:** ReactJS + Vite + CSS Modules
* **Graphics:** Custom modular SVGs for crisp, scalable holiday animations
* **State & Storage:** `tauri-plugin-store` for persistent JSON local configuration

### Getting Started (Development)

1. **Prerequisites:** Make sure you have [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/), and the Tauri CLI installed.
2. **Clone the repository:**
   ```bash
   git clone [https://github.com/YOUR_USERNAME/maranatha.git](https://github.com/YOUR_USERNAME/maranatha.git)
   cd maranatha