# Feature Matrix — ScriptUI vs CEP Panel

The single source of truth for what each tool supports. Update this file in the
same commit as any feature change.

**Status legend:** ✅ full · 🟡 partial (see note) · ❌ not available

| Feature | ScriptUI (`.jsx`) | CEP panel | Notes |
|---|:---:|:---:|---|
| **Project creation** |
| New project from template (naming + folder tree) | ✅ | ✅ | Identical output; shared settings store |
| Templates: Sunrise / InterScroller / Expandable / DOOH H+V | ✅ | ✅ | Expandable added v0.2.8, seeded into saved lists v0.3.1 |
| Template management (add/edit/delete/generate placeholder) | ✅ | ✅ | CEP: in Settings tab |
| Import & standardize external project | ✅ | ❌ | |
| Live filename/path preview | ✅ | ✅ | |
| Recent files panel | ✅ | ✅ | |
| V+ / R+ version & revision management | ✅ | ✅ | |
| `_GlobalAssets` import | ✅ | ✅ | |
| **Rendering** |
| Add Main comp to Render Queue (template output modules) | ✅ | ✅ | PNG+Alpha → `Render_R#/PNG_Sequence`, H.264 → `Render_R#/MP4` |
| Send to Media Encoder | ✅ | ✅ | |
| **DOOH optimization** |
| Size-capped MP4 optimization | ✅ | ✅ | ScriptUI: CRF-18 + strict ABR fallback. CEP: two-pass ABR + verify + retry |
| Batch mode | ✅ | ✅ | |
| Async (AE stays responsive) + instant cancel | ❌ | ✅ | ScriptUI blocks AE during encodes (synchronous callSystem) |
| Backup-swap replacement (original never lost) | 🟡 | ✅ | CEP path is unit-tested (`cep/test/backupswap.test.js`) |
| AE file-lock release + relink on replace | ✅ | ✅ | |
| **Post-render (Sunrise)** |
| PNG sequence → WebM (VP9+alpha, two-pass) | ✅ | ✅ | CEP card enabled v0.4.4 — needs one real conversion verified in AE |
| MOV fallback chain (HEVC-alpha → ProRes 4444 → H.264) | ✅ | 🟡 | Same code path as above |
| HTML preview (Mediabunny) + ZIP bundle | ✅ | 🟡 | Same code path as above |
| **Collect & upload** |
| Collect linked assets (remove unused, pack report) | ✅ | ✅ | CEP collects to a chosen local folder |
| Google Drive mirror (copy into local Drive-sync folder) | ✅ | ❌ | Not an API upload — filesystem mirror to the `gdrive_root` path. Port planned |
| Shared `_Common_Assets` dedup on Drive | ✅ | ❌ | Part of the same routine |
| **Infrastructure** |
| ffmpeg auto-detect / auto-install (Win + Mac) | ✅ | ✅ | Windows download SHA-256-verified |
| Auto-update | ✅ | ✅ | ScriptUI: commit-SHA check + raw download. CEP: SHA-256-verified download, staged extract + validation, atomic swap, rollback backup kept until the new version boots |
| What's New changelog popup after update | ❌ | ✅ | |
| Settings sync between the two tools | ✅ | ✅ | Same AE prefs section `BigHappyLauncher` |
| Headless test suite + CI | ❌ | ✅ | `cep/test/`, GitHub Actions macOS+Windows |

## Retirement blockers for the ScriptUI panel

1. ~~Sunrise post-render card un-hidden in CEP~~ ✅ enabled (v0.4.4) — pending one verified conversion in AE
2. Google Drive mirror ported to CEP
3. Import & standardize ported to CEP (or explicitly dropped)
4. ~~CEP updater hardened~~ ✅ done (v0.4.0 — checksum, staged extract, atomic swap, rollback)
