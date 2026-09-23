# BigHappy Launcher — User Guide

This guide explains how animators and producers use the **BigHappy Launcher**
panel in Adobe After Effects. It covers the recommended CEP panel included with
BigHappy Launcher v0.4.4.

## What you can do with the launcher

- Create consistently named After Effects projects from team templates.
- Create the standard project, asset, render, and collect folders.
- Add the project's `Main` composition to the Render Queue with the correct
  output format and destination.
- Convert a Sunrise PNG sequence into WebM, MOV, HTML, and ZIP deliverables.
- Collect a project and all linked footage into a delivery folder.
- Optimize one or more MP4 files to a strict delivery size.

## Install and open the panel

1. Close After Effects.
2. Install the newest `BigHappyLauncher_v*.zxp` file from the `dist` folder
   using a ZXP installer such as aescripts ZXP Installer.
3. Restart After Effects.
4. In After Effects, choose **Window → Extensions → BigHappy Launcher**.
5. Dock the panel anywhere in the After Effects workspace.

The CEP panel requires After Effects 2021 or newer. If the panel is not listed
after installation, restart After Effects once more.

## First-time setup

Open the **Settings** tab before creating your first project.

### 1. Set the base work folder

Under **Projects**, choose **Base work folder**. This is the top-level folder
where the launcher will create the year, quarter, campaign, and project
folders.

For example:

```text
/Volumes/Studio/Jobs
└── 2026
    └── Q3
        └── Brand_Campaign
```

The folder must already exist. The launcher creates everything below it.

### 2. Set the templates folder

Choose **Templates folder**. The default location is:

```text
Documents/BH_Templates
```

If the template list says **FILE MISSING**, use one of these options:

- Click **edit** beside a template and select the correct team `.aep` file.
- Click **Generate missing files** to create basic placeholder projects with
  the correct dimensions, frame rate, duration, folders, and `Main` comp.

Generated files are structural placeholders. They do not contain the complete
creative design of a separately supplied production template.

### 3. Check FFmpeg

Under **FFmpeg**, click **Detect**.

FFmpeg is needed for MP4 optimization and Sunrise post-render conversion. If
it is not installed, the launcher offers to install it the first time one of
those features is used. You can also enter an existing FFmpeg path manually.

## Create a new project

Open the **Launcher** tab.

1. Select the required **Template**.
2. Enter the **Brand**. This field is required.
3. Enter the **Campaign**, if applicable.
4. Select the **Year** and **Quarter**.
5. Set the **Version** and **Revision**:
   - Use a new version for a new creative direction: `V1`, `V2`, and so on.
   - Use a new revision for a change round within that version: `R1`, `R2`,
     and so on.
6. Check the filename preview.
7. Click **Create project**.

The launcher protects an open project with unsaved changes. Follow the prompt
to save it or explicitly continue without saving.

### Example project

These entries:

```text
Template:  Sunrise
Brand:     Nike
Campaign:  SummerSale
Year:      2026
Quarter:   Q3
Version:   1
Revision:  1
```

create a project similar to:

```text
Nike_SummerSale_Q3_750x300_V1_R1.aep
```

inside:

```text
Base/2026/Q3/Nike_SummerSale/Sunrise_750x300/V1/
├── Assets/
│   ├── Images/
│   └── Screens/
└── AE_File/
    ├── Nike_SummerSale_Q3_750x300_V1_R1.aep
    ├── Collect_Files/
    └── Render_R1/
        ├── MP4/
        └── PNG_Sequence/
```

DOOH projects use a shorter delivery-style filename such as:

```text
DOOH_SummerSale_1920x1080_V1_R1.aep
```

## Open and manage projects

The **Current project** card shows the open project, its `Main` composition,
frame size, frame rate, duration, and whether it has unsaved changes.

- **Open project…** opens an existing `.aep`.
- **Save** saves the current After Effects project.
- **Reveal** opens the project's folder in Finder or File Explorer.
- **Recent projects** reopens one of the last ten projects used by either the
  CEP panel or the legacy ScriptUI launcher.

For the automated render workflow, the project must be saved and contain a
composition named exactly `Main`.

## Add the Main comp to the Render Queue

Open the project, then select the **Render** tab.

1. Review the comp, format, destination folder, and output filename shown in
   the **Render queue** card.
2. Leave **Send to Media Encoder and start render** unchecked to add the item
   to the After Effects Render Queue.
3. Check it if you want to send the item to Adobe Media Encoder immediately.
4. Click **Add to render queue**.

The launcher chooses the output automatically:

| Project type | Output | Destination |
|---|---|---|
| Sunrise | PNG sequence with alpha | `Render_R#/PNG_Sequence/` |
| InterScroller, Expandable, and DOOH | H.264 MP4 | `Render_R#/MP4/` |

If **Add to render queue** is disabled, save the project and confirm that it
contains a `Main` composition.

## Convert a Sunrise PNG sequence

After rendering the Sunrise PNG sequence:

1. Go to **Render → Sunrise post-render**.
2. Click **Auto-Detect** to use the current project's
   `Render_R#/PNG_Sequence` folder, or click **Choose render folder…**.
3. Select the required outputs:
   - **WebM** — VP9 video with alpha.
   - **MOV** — MOV delivery file using the best available alpha-capable codec,
     with fallbacks where required.
   - **HTML** — browser preview.
   - **ZIP** — packaged delivery bundle.
4. Click **Convert**.
5. Use **Cancel** if you need to stop the active conversion.
6. Click **Show Files** when the conversion completes.

The converted files are written beside the selected PNG sequence. Existing
outputs are not overwritten without confirmation.

## Collect a project for handoff

With a saved project open:

1. Go to **Render → Collect project**.
2. Click **Collect project…**.
3. Review any missing-footage warning.
4. Choose the parent folder for the collected package.

The launcher creates a standardized copy containing:

- A copy of the After Effects project.
- Linked footage in a `(Footage)` folder.
- `_Pack_Report.txt` with fonts, effects, and missing-file information.

The original project on disk is not modified. The CEP panel collects locally;
it does not copy or mirror the package to the NAS.

## Optimize MP4 files for DOOH delivery

Open the **DOOH** tab.

1. Drag MP4 files into the drop area, or click it to browse.
2. Confirm the queued filenames and source sizes.
3. Set **Target size (MB)**. The normal DOOH target is `6.8`, leaving room
   below a 7 MB delivery limit.
4. Click **Optimize**.
5. Watch the current-file and overall progress bars.
6. Use **Cancel** to stop the active encode and skip the remaining queue.
7. Click **Show in Finder** or **Show in Explorer** when finished.

Important behavior:

- Expandable files detected at `750×1334` automatically use a maximum target
  of `3.8 MB`, leaving room below their 4 MB delivery limit.
- A file already below its target is skipped and left unchanged.
- When optimization succeeds, the verified optimized file replaces the
  original at the same path.
- The original is protected by a backup-swap and is never deleted before the
  replacement is verified.
- If the target cannot be met, the original stays in place and the best result
  is saved separately with `_Optimized.mp4` in its name.
- If the MP4 is linked in After Effects, the launcher temporarily releases the
  file lock and then relinks it.

Do not close After Effects or disconnect the source drive while an optimization
is running.

## Manage templates

Go to **Settings → Templates**.

- **Add** creates a template entry.
- **edit** changes its name, dimensions, frame rate, duration, or source
  `.aep`.
- **delete** removes the entry from the launcher but does not delete its `.aep`
  file.
- **Generate missing files** creates placeholder `.aep` files for every entry
  that does not have a valid source file.

When creating or editing a template, leave **Template .aep** empty if you want
the launcher to generate a placeholder.

## Updates and diagnostics

An **Update available** pill appears when a newer signed release is available.
Click it and follow the prompts, then restart After Effects to load the new
version.

For support:

1. Go to **Settings → Diagnostics**.
2. Click **Refresh**.
3. Use **Copy report** or **Save…**.
4. Send the report together with the exact error message or `BH-` error code.

## Troubleshooting

| Problem | What to do |
|---|---|
| Panel is missing from the Window menu | Restart After Effects. If it is still missing, reinstall the newest signed `.zxp`. |
| `FILE MISSING` beside a template | Edit the entry and select its `.aep`, or click **Generate missing files**. |
| `BH-1005` / base folder does not exist | Choose an existing **Base work folder** in Settings. |
| `BH-1006` / path too long | Shorten the base path, Brand, or Campaign name. |
| `BH-2003` / no saved project | Save or open a project before rendering or collecting. |
| `BH-3001` / Main composition not found | Create or rename the delivery composition to exactly `Main`. |
| FFmpeg not found | Click **Settings → FFmpeg → Detect**, accept automatic installation, or enter the executable path. |
| Auto-Detect cannot find a PNG sequence | Select the actual PNG folder with **Choose render folder…**. |
| MP4 could not be replaced | Close any app using the file and run it again; check the log for a separately saved `_Optimized.mp4`. |
| Collect reports missing footage | Relink the files in After Effects, then collect again. |

## Legacy ScriptUI panel

The older `BigHappyLauncher_Templates.jsx` panel is still available for
After Effects CC 2019 and newer. It shares templates, paths, recent projects,
and other settings with the CEP panel.

Use the CEP panel for normal work because its FFmpeg jobs run in the background
with live progress and immediate cancellation. Use the ScriptUI panel only for
workflows that have not yet moved to CEP, including NAS folder
mirroring and import-and-standardize.

