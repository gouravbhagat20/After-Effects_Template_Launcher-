# Big Happy Launcher v1.0
## After Effects Template & DOOH Optimization Tool

**Created by Gourav Bhagat**

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

### 📦 DOOH Optimization
Compress MP4 files to meet DOOH size requirements (< 7MB).

**Features:**
- Single file or **batch optimization**
- Real-time progress bar
- Enhanced results (file size, savings %, bitrate)
- Works without project open
- **Auto-installs FFmpeg** if not found

**How to use:**
1. Click **DOOH Optimize** button
2. Select MP4 file(s) - Ctrl+Click for multiple!
3. Enter duration (if no project open)
4. Wait for optimization

### 🔄 Post-Render Conversion
Convert PNG sequences to WebM/MOV with transparency.

---

## Requirements

- **After Effects CC 2019+**
- **FFmpeg** (auto-installed on first use, or manual setup)

---

## FFmpeg Setup

### Automatic (Recommended)
1. Click **DOOH Optimize**
2. Click **"⚡ Auto Install"**
3. Wait for download & setup (~1-2 min)

### Manual
1. Download from: https://ffmpeg.org/download.html
2. Extract to: `C:\ffmpeg`
3. In script: Settings ⚙ > Post-Render > Set Path to `C:\ffmpeg\bin\ffmpeg.exe`

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Run Unit Tests | Alt+Click on title |
| Run Stress Tests | Shift+Click on title |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "FFmpeg not found" | Auto-install or set path in Settings |
| "Path too long" error | Use shorter Brand/Campaign names |
| "Permission denied" | Enable script permissions in Preferences |
| Script won't load | Restart After Effects after copying |

---

## Version History

| Version | Changes |
|---------|---------|
| **v1.0** | Initial release with full feature set |
| | • Template management & standardized naming |
| | • DOOH batch optimization with progress |
| | • Auto FFmpeg download & setup |
| | • Post-render conversion (WebM/MOV) |
| | • Path length safety checks |
| | • Enhanced results with file savings |

---

## Author

**Gourav Bhagat**  
Big Happy Launcher © 2026

---

*Made with ❤️ for the animation community*
