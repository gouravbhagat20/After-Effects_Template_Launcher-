# Big Happy Launcher v1.0
## After Effects Template & DOOH Optimization Tool

---

## Quick Install

1. **Copy the script file** to:
   ```
   Windows: C:\Program Files\Adobe\Adobe After Effects [version]\Support Files\Scripts\ScriptUI Panels\
   Mac: /Applications/Adobe After Effects [version]/Scripts/ScriptUI Panels/
   ```

2. **Enable Script Access** in After Effects:
   - Edit > Preferences > Scripting & Expressions
   - ✅ "Allow Scripts to Write Files and Access Network"

3. **Restart After Effects** and find it under: `Window > BigHappyLauncher_Templates.jsx`

---

## Features

### 🎬 Template Management
- Create new projects with standardized naming
- Auto-generate folder structure (AE, Assets, Render)
- Support for Sunrise, Interscroller, and DOOH templates

### 📦 DOOH Optimization (NEW!)
Compress MP4 files to meet DOOH size requirements (< 7MB).

**How to use:**
1. Click **DOOH Optimize** button
2. Select MP4 file(s) - supports batch!
3. Enter duration (if no project open)
4. Wait for optimization

**Batch Mode:** Ctrl+Click to select multiple files!

### 🔄 Post-Render Conversion
Convert PNG sequences to WebM/MOV with transparency.

---

## Requirements

- **After Effects CC 2019+**
- **FFmpeg** (for DOOH optimization & post-render)
  - Set path in Settings > Post-Render tab

---

## FFmpeg Setup

1. Download from: https://ffmpeg.org/download.html
2. Extract to a folder (e.g., `C:\ffmpeg`)
3. In BigHappyLauncher: Settings ⚙ > Post-Render > Set FFmpeg Path

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Run Unit Tests | Alt+Click on title |
| Run Stress Tests | Shift+Click on title |

---

## Troubleshooting

**"FFmpeg not found"**
→ Set FFmpeg path in Settings > Post-Render tab

**"Path too long" error**
→ Use shorter Brand/Campaign names or shallower base folder

**Script won't load**
→ Enable "Allow Scripts to Write Files" in Preferences

---

## Version History

- **v2.2** - Batch DOOH optimization, progress polling, enhanced results
- **v2.1** - Path length safety, JSON improvements, unit tests
- **v2.0** - Initial public release

---

*Big Happy Launcher © 2026*
