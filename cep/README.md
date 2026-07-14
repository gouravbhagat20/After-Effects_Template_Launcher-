# BigHappy Launcher — CEP Extension (v0.1.0)

Cross-platform After Effects panel (Windows + macOS, AE 2021+ / CEP 11). This is the
long-term replacement for `BigHappyLauncher_Templates.jsx`: same AE-side logic
model, but the UI is HTML and all ffmpeg/filesystem work runs **asynchronously
in Node.js** — real progress bars, a Cancel button that actually kills the
encode, and no frozen AE during optimization.

## What works in v0.1

- **Launcher tab** — New Project from template: identical naming
  (`Brand_Campaign_Q#_WxH_V#_R#.aep`, DOOH variant) and folder structure
  (`Base/Year/Quarter/Brand_Campaign/Template_WxH/V#/AE_File/Render_R#` +
  `Assets/...`) to the ScriptUI version, with live filename preview,
  `_GlobalAssets` import, and unsaved-changes guard. Plus live
  current-project card, Open/Save/Reveal, and recent projects.
- **Templates tab** — add/edit/delete templates and generate missing
  placeholder `.aep` files. Templates, base folder, ffmpeg path, and recents
  are stored in AE preferences under the SAME section ("BigHappyLauncher")
  the ScriptUI version uses — both tools stay in sync automatically.
- **DOOH Optimizer tab** — pick MP4s, true two-pass H.264 size targeting with
  automatic re-encode if the output exceeds the cap, per-file + overall
  progress, instant cancel, backup-swap replacement (original is never deleted
  before the optimized file is confirmed in place), AE file-lock release/relink
  via the host bridge.
- **Settings tab** — ffmpeg path (auto-detect covers PATH, Homebrew, and common
  Windows installs), base work folder.

Not yet ported from the ScriptUI version: Collect & Upload, render-queue
helpers, PNG-sequence post-render conversion. The `.jsx` script remains the
production tool for those.

## Install (development)

**Mac:** `./install-mac.sh` &nbsp;&nbsp; **Windows:** double-click `install-win.bat`

Both enable CEP `PlayerDebugMode` (required for unsigned extensions), place the
extension in the user CEP folder, and the panel then appears under
**Window → Extensions → BigHappy Launcher** after restarting AE.

## Architecture

```
cep/
├── CSXS/manifest.xml   Extension manifest (AEFT 16.0+, Node enabled)
├── index.html          Panel markup (3 tabs)
├── css/style.css       Dark theme
├── js/CSInterface.js   Slim __adobe_cep__ wrapper
├── js/ffmpeg.js        Node ffmpeg engine: detect / probe / two-pass optimize / cancel
├── js/main.js          Panel logic + BH.* host bridge
├── jsx/host.jsx        ExtendScript host API (JSON in/out): project info,
│                       open/save, file-lock release + relink
└── .debug              Remote debugging (http://localhost:8092 while AE runs)
```

Division of labor: **anything that needs the AE DOM** (project, comps, footage,
render queue) lives in `jsx/host.jsx` and is called with
`host("fnName", args...)` from the panel. **Everything else** (ffmpeg,
downloads, file moves, dialogs) runs in the panel's Node context — no generated
`.bat`/`.sh` scripts, no shell-quoting issues, identical behavior on both OSes.

## Debugging

With AE running and the panel open, visit `http://localhost:8092` in Chrome for
full DevTools against the panel.

## Distribution (later)

Package with Adobe's `ZXPSignCmd` and a self-signed certificate:

```
ZXPSignCmd -selfSignedCert US NY BigHappy BigHappy password cert.p12
ZXPSignCmd -sign cep BigHappyLauncher.zxp cert.p12 password -tsa http://timestamp.digicert.com
```

Users install the `.zxp` with any ZXP installer (or unzip into the CEP
extensions folder with PlayerDebugMode on).
