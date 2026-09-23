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
| Size-capped MP4 optimization | ✅ | ✅ | ScriptUI: CRF-18 + strict ABR fallback. CEP: two-pass ABR + verify + retry. Per-unit caps (Expandable <4 MB, DOOH <7 MB) in both since CEP v0.4.3 / ScriptUI v1.3 |
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
| NAS mirror (copy into the NAS share) | ✅ | ❌ | Filesystem copy to the `nas_root` path (mounted share or UNC `\\NAS\share`). Port planned |
| Shared `_Common_Assets` dedup on NAS | ✅ | ❌ | Part of the same routine |
| **Interface** |
| Polished responsive workspace (bundled Geist typography, fluid GPU-friendly motion, dark/light themes, contextual tools and delivery presets) | ❌ | ✅ | Compact docked layout; destination preview, persistent results, keyboard help and reduced-motion support |
| **Infrastructure** |
| ffmpeg auto-detect / auto-install (Win + Mac) | ✅ | ✅ | Windows download SHA-256-verified. Mac (evermeet.cx publishes no SHA-256): exact-size check + `unzip -t` + `-version` run before the binary is accepted |
| Auto-update | ✅ | ✅ | Both SHA-256-verified, fail closed. ScriptUI: commit-SHA check + raw download verified against the published `.jsx.sha256`. CEP: verified download, staged extract + validation, atomic swap, rollback backup kept until the new version boots; network calls time out |
| What's New changelog popup after update | ❌ | ✅ | |
| Settings sync between the two tools | ✅ | ✅ | Same AE prefs section `BigHappyLauncher` |
| Headless test suite + CI | ❌ | ✅ | `cep/test/` (86 tests incl. the updater module), GitHub Actions macOS+Windows; CI also parse-checks both `.jsx` files and enforces release version sync + published checksums |

## Retirement blockers for the ScriptUI panel

1. ~~Sunrise post-render card un-hidden in CEP~~ ✅ enabled (v0.4.4) — pending one verified conversion in AE
2. NAS mirror ported to CEP
3. Import & standardize ported to CEP (or explicitly dropped)
4. ~~CEP updater hardened~~ ✅ done (v0.4.0 — checksum, staged extract, atomic swap, rollback)
