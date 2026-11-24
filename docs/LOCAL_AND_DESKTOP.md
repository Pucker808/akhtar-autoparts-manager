# Local folder data & downloadable app

## What you get today (in the web / PWA app)

1. **Local data folder (PC – Chrome or Edge)**  
   Settings → **Local data folder** → **Choose folder**.  
   Pick any folder (e.g. `Documents\AkhtarAutos`).  
   The app writes `akhtar-autos-backup.json` there after every saved change when auto-save is on.  
   If the browser cache is cleared, use **Restore from folder** to load the data again.

2. **Download / Import backup (PC and Android)**  
   Works in every browser:  
   - **Download backup file** – saves JSON to Downloads.  
   - **Import backup file** – load that JSON on another phone or PC.

3. **Google Drive** (optional) – unchanged; still a cloud snapshot, not a live multi-device sync.

## Recommended workflow

| Device | Recommended storage |
|--------|---------------------|
| Shop PC (Chrome/Edge) | Choose local folder + auto-save ON |
| Android phone | Download backup after the day, or Import when needed |
| Second PC | Same shared folder (OneDrive/USB) or Import the JSON |

## Building a desktop installer (Windows)

The UI is a normal Vite web app. Package it with **Tauri** so it runs as a `.exe` with full disk access.

### Prerequisites on your Windows PC

- Node.js 20+
- Rust: https://rustup.rs  
- Microsoft C++ Build Tools / Visual Studio Build Tools  
- WebView2 (usually already on Windows 10/11)

### One-time setup in the project

```bash
cd akhtar-autoparts-manager
npm install
npm install -D @tauri-apps/cli
npx tauri init
# When asked:
#   App name: Akhtar Autos
#   Window title: Akhtar Autos
#   Dev URL: http://localhost:5173
#   Frontend dist: dist
```

Add scripts to `package.json`:

```json
"desktop:dev": "tauri dev",
"desktop:build": "tauri build"
```

Build the installer:

```bash
npm run build
npm run desktop:build
```

Installers appear under `src-tauri/target/release/bundle/` (MSI / NSIS).

With Tauri, the same **Choose folder** flow works inside the desktop window. Later you can switch the storage backend to Tauri’s native FS APIs so a folder is required at first launch.

## Building an Android APK (Capacitor)

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Akhtar Autos" com.akhtar.autos
npm run build
npx cap add android
npx cap sync
npx cap open android
```

In Android Studio: Build → Build Bundle(s) / APK(s).

On Android, the **directory picker is limited**; use **Download / Import backup** or Capacitor’s Filesystem plugin to write under app storage / shared documents.

## Data file format

`akhtar-autos-backup.json` contains:

- `app`: `"Akhtar Autos"`
- `formatVersion`: `1`
- `exportedAt`: ISO timestamp
- Full table dumps: `items`, `sales`, `purchases`, …

This matches the Google Drive backup format so Drive and local folder files are interchangeable.
