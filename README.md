# Big Happy Launcher
## After Effects Template & DOOH Optimization Tools

**Created by Gourav Bhagat**

This repository ships **two tools that share one settings store** and stay in
sync automatically (AE preferences section `BigHappyLauncher`):

| Tool | File | Current version | Update channel |
|---|---|---|---|
| **CEP panel** (long-term replacement) | `cep/` | see `cep/CSXS/manifest.xml` | Versioned signed `.zxp` in `dist/` — the panel notifies users and self-updates |
| **ScriptUI panel** (legacy, still supported) | `BigHappyLauncher_Templates.jsx` | rolling | Any push to `main` touching the file **is** the release (clients compare commit SHA) |

For the authoritative feature-by-feature comparison, see **[FEATURES.md](FEATURES.md)**.

---

## What Does This Tool Do?

🎯 **Template Project Creation** — standardized projects with naming
(`Brand_Campaign_Q#_WxH_V#_R#.aep`, DOOH variant) and an organized folder tree.
Templates: Sunrise (750×300), InterScroller (880×1912), Expandable (750×1334),
DOOH Horizontal (1920×1080), DOOH Vertical (1080×1920).

📦 **DOOH Video Optimization** — batch-compress MP4s under a hard size cap
(default 6.8 MB target for the 7 MB DOOH limit):
- **CEP panel:** true **two-pass ABR** size targeting, output verified against
  the cap, automatic retry at a lower bitrate, backup-swap replacement (the
  original is never deleted before the optimized file is confirmed in place).
  Fully async — AE stays responsive, Cancel kills the encode instantly.
- **ScriptUI:** CRF-18-constrained single pass with a bitrate ceiling, plus a
  **strict ABR fallback re-encode** when the CRF pass overshoots the cap.
- Both use sharpness-tuned x264 settings (negative deblock, psy-rd, adaptive
  quantization) so text and fine detail survive the re-encode.

🎬 **Post-Render Processing** — PNG sequence → WebM (VP9 + alpha, two-pass),
MOV (HEVC-alpha → ProRes 4444 → H.264 fallback chain), HTML preview
(self-hosted Mediabunny player), ZIP bundle.

⚡ **Smart Automation** — ffmpeg auto-detect/auto-install (Win + Mac), V+/R+
version management, path-length safety checks, recent-files panel, update
notifications.

---

## Project Folder Structure

`CREATE PROJECT` scaffolds (identical in both tools):

```
Base / Year / Quarter / Brand_Campaign / Template_WxH /
└── V1/
    ├── Assets/
    │   ├── Images/
    │   └── Screens/
    └── AE_File/
        ├── Brand_Campaign_Q#_WxH_V1_R1.aep
        ├── Collect_Files/
        └── Render_R1/
            ├── MP4/            ← H.264 renders land here
            └── PNG_Sequence/   ← PNG+Alpha renders land here
```

Renders route into `MP4/` or `PNG_Sequence/` automatically by output format;
the post-render and DOOH tools look in those subfolders first and fall back to
the `Render_R#` root for projects created with the older flat layout.

---

## Screenshots

<!-- TODO(screenshots): retake against the current CEP panel and drop into screenshots/ -->
![Main Panel](screenshots/main_panel.png)
*Main interface — template selection, project details, actions*

![Batch Progress](screenshots/batch_progress.png)
*DOOH batch optimization with per-file progress*

![Batch Results](screenshots/batch_results.png)
*Per-file results: size before/after and savings*

---

## Install

### CEP panel (recommended)
1. Grab `dist/BigHappyLauncher_v*.zxp`
2. Install with any ZXP installer (e.g. [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/))
3. Restart AE → **Window → Extensions → BigHappy Launcher**

Requires AE 2021+ (CEP 11). Signed — no PlayerDebugMode needed. See
[cep/README.md](cep/README.md) for dev installs, architecture, and release builds.

### ScriptUI panel (legacy)
1. Copy `BigHappyLauncher_Templates.jsx` to:
   ```
   Windows: C:\Program Files\Adobe\Adobe After Effects [version]\Support Files\Scripts\ScriptUI Panels\
   Mac:     /Applications/Adobe After Effects [version]/Scripts/ScriptUI Panels/
   ```
2. Enable **Edit → Preferences → Scripting & Expressions →
   "Allow Scripts to Write Files and Access Network"**
3. Restart AE → `Window > BigHappyLauncher_Templates.jsx`

Requires AE CC 2019+.

---

## FFmpeg Setup

**Automatic (recommended):** run any optimize action — if ffmpeg is missing
you'll be offered a one-click install (Homebrew on Mac; verified
gyan.dev download on Windows, SHA-256 checked).

**Manual:** download from [ffmpeg.org](https://ffmpeg.org/download.html),
then set the path in Settings (`C:\ffmpeg\bin\ffmpeg.exe` or
`/opt/homebrew/bin/ffmpeg`).

---

## Versioning Workflow

| Action | Effect |
|---|---|
| **R+** | `…_V1_R1.aep` → `…_V1_R2.aep` (small edits) |
| **V+** | `…_V1_R3.aep` → `…_V2_R1.aep` (major changes, revision resets) |
| **Collect** | Removes unused footage, collects linked assets, mirrors to the configured Google Drive folder (ScriptUI; CEP collect is local — see FEATURES.md) |

---

## Development

- **Tests:** `cd cep && npm test` — headless Node test suite (naming, parsing,
  folder creation, path limits, bitrate math, backup-swap recovery, sequence
  detection). Runs in CI on macOS + Windows (`.github/workflows/ci.yml`).
- **Releases:** ScriptUI ships on push; the CEP panel needs 4 synced changes —
  `manifest.xml` versions, `BH_VERSION` + `CHANGELOG` in `cep/js/main.js`, and
  the rebuilt `dist/*.zxp` (`./cep/build-zxp.sh`).

### Manual QA checklist (before a CEP release)
CI covers the pure logic; these need a human in front of AE:

- [ ] Create project from each template → folder tree + naming correct
- [ ] Render queue: Sunrise (PNG+Alpha → `PNG_Sequence/`), DOOH (H.264 → `MP4/`)
- [ ] DOOH optimize: single + batch, output ≤ target, original recoverable on cancel
- [ ] Post-render convert: WebM/MOV/HTML/ZIP from a real render
- [ ] Update flow: previous version notifies → installs → What's New shows
- [ ] Matrix: Windows 10/11 + macOS, AE 2021 → current

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "FFmpeg not found" | Auto-install, or set the path in Settings |
| "Path too long" (BH-1006) | Use shorter Brand/Campaign names |
| "Permission denied" | Enable script write access in AE preferences |
| Panel/script won't load | Restart AE after installing |
| Update notification but download fails | The release may still be publishing — retry in a few minutes |

---

## Known Constraints

- **FFmpeg is an external dependency** — auto-detected and auto-installable on
  both OSes; Windows downloads are SHA-256-verified against the publisher.
- **HTML previews load Mediabunny from `cdn.bighappy.co`** (self-hosted,
  pinned) — previews need network access.
- **ScriptUI blocks AE during encodes** — `system.callSystem` is synchronous.
  This is the core reason the CEP panel exists; its encodes are fully async.
- **Generated templates are spec placeholders** — bare comps at the right
  size/fps/duration; the full creative templates ship as `.aep` files.

---

## Author

**Gourav Bhagat**
Big Happy Launcher © 2026

*Made with ❤️ for the animators*
