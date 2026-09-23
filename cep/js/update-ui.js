/*
    BHUpdateUI — the self-update flow's user interface.

    All the risky work (download, checksum verification, staging, atomic swap,
    rollback) lives in js/updater.js, which is pure and unit-tested. This file
    is only the parts that need a user: the pill, the prompts, and choosing
    where a new version can actually be written.
*/
(function (global) {
    "use strict";

    var CHANGELOG = {
        "0.4.6": [
            "Update checks retry once automatically, so a brief network or GitHub hiccup no longer shows an error",
            "If an update check still fails, the message now says why (e.g. HTTP status or timeout)"
        ],
        "0.4.5": [
            "New NAS folder setting (Settings → Projects), shared with the ScriptUI launcher — Google Drive sync has been replaced by NAS",
            "Interrupted optimizes now repair themselves: if the panel or AE closes mid-encode, footage left as a BH_RELINK placeholder is relinked automatically at the next launch instead of stranding you",
            "The panel can no longer hang forever on a busy After Effects — every host call now has a time limit and reports what happened",
            "Accessibility: toasts and progress are announced to screen readers, and dialogs keep keyboard focus inside them",
            "Dropping the same file twice no longer queues it twice",
            "Reliability: the auto-updater moved into its own tested module (35 new tests) with network timeouts — a stalled download can no longer freeze the panel",
            "Windows fix: footage whose path differs only in upper/lower case is now correctly released before optimizing (no more locked-file rename failures)",
            "If a footage item can't be released or relinked, or a Global Asset fails to import, the panel now tells you instead of failing silently",
            "Post-render conversions now pick the right size target for the unit type (Expandable vs DOOH) instead of always using the 6.8 MB DOOH target"
        ],
        "0.4.4": [
            "Sunrise post-render is now available in the Render tab: convert a rendered PNG sequence to WebM / MOV / HTML / ZIP with progress and cancel"
        ],
        "0.4.3": [
            "Per-unit size caps: Expandable files (750×1334) are auto-detected and optimized to under 4 MB (3.8 target); DOOH units keep the under-7 MB target (6.8)",
            "Mixed batches work — each file gets the right cap from its resolution"
        ],
        "0.4.2": [
            "Output now lands closer to the target size: acceptance window tightened from 80–100% to 90–100% (e.g. 6.1–6.8 MB for a 6.8 target)"
        ],
        "0.4.1": [
            "Strict size cap: if retries somehow still end over the target, a final conservative encode guarantees the output fits under it"
        ],
        "0.4.0": [
            "Safer auto-updates: downloads are now verified against a published SHA-256 checksum before anything is touched",
            "Updates extract to a staging area and are fully validated before an atomic swap into place",
            "The previous version is kept as a rollback backup until the new version starts successfully"
        ],
        "0.3.5": [
            "Optimizer now fills the size budget: ask for 6.8 MB and the output lands near 6.8 MB (80-100% of target), spending the whole budget on quality instead of stopping at 2-3 MB"
        ],
        "0.3.4": [
            "Optimizer is now quality-first: clips are encoded at constant visual quality (CRF 18) whenever they fit under the size cap — noticeably sharper output",
            "Strict two-pass size targeting only kicks in when the quality pass would exceed the cap"
        ],
        "0.3.3": [
            "Internal: bitrate math extracted into a shared, unit-tested module (no behavior change)",
            "New automated test suite guards naming, parsing, folder creation, path limits, bitrate math, and file-swap recovery on every release"
        ],
        "0.3.2": [
            "Sharper text when optimizing/size-capping MP4s: the re-encode no longer softens high-contrast text edges (negative deblock + psy-rd + stronger adaptive quantization)"
        ],
        "0.3.1": [
            "Fixed: the Expandable (750×1334) template now appears for everyone — it is added once to existing saved template lists (delete it and it stays deleted)"
        ],
        "0.3.0": [
            "Renders now sort automatically into Render_R#/MP4 or Render_R#/PNG_Sequence by output type",
            "Assets is now just Images and Screens for every template",
            "Post-render and DOOH tools auto-find the new subfolders (older projects still work)",
            "New folders apply to newly created projects; routing/detection works for both layouts"
        ],
        "0.2.9": [
            "New project folder layout: Assets now has Images/Screens; AE_File adds Collect_Files and Render_R#/{MP4, PNG_Sequence}",
            "Applies to newly created projects only"
        ],
        "0.2.8": [
            "New template: Expandable (750×1334)"
        ],
        "0.2.7": [
            "Video quality: fixed detailed elements getting blurred during optimize/export — busy frames were being starved of bitrate by a maxrate ceiling pinned to the average",
            "MP4 optimizer now encodes with the higher-quality x264 'slow' preset and adaptive quantization (aq-mode 3) for the same target size",
            "Non-DOOH WebM export quality raised (CRF 24 → 20)",
            "Trade-off: encodes take longer for the extra quality at the same file size"
        ],
        "0.2.6": [
            "DOOH optimize: AE file locks are now actually released before replacing (relink used a nonexistent temp file and failed silently, breaking replacement on Windows)",
            "Footage items keep their names and render-queue outputs are restored after optimizing",
            "DOOH target size now syncs with the shared setting used by the ScriptUI version",
            "Fixed overlapping dialogs hanging the panel (update check + What's New at boot)",
            "A successful file swap is no longer reported as failed when backup cleanup is blocked"
        ],
        "0.2.5": [
            "Update pipeline test release — if you are reading this, auto-update worked on your machine"
        ],
        "0.2.4": [
            "Windows fix: when the extension lives in Program Files (admin-only), updates now install to your user extensions folder instead — no admin rights needed"
        ],
        "0.2.3": [
            "Fixed self-update on development installs: the panel now finds the repo through the extension symlink"
        ],
        "0.2.2": [
            "Development installs now update themselves: the update dialog runs git pull and reloads the panel",
            "Full update pipeline verified end-to-end (notify → install → What's New)"
        ],
        "0.2.1": [
            "Update notifications now pop up automatically when a new version is released (once per version)",
            "Update checks re-run hourly while the panel is open, not just at startup",
            "Manual “Check for updates” button in Settings → About"
        ],
        "0.2.0": [
            "New Render tab: Render Queue with template-specific output modules, Collect Project with pack report",
            "Diagnostics section in Settings with copyable troubleshooting report",
            "Update notifications when a newer version is on GitHub",
            "Signed .zxp installer for easy team installs",
            "UI polish: icons, tooltips, theme adaptation, animations"
        ]
    };

    function init(core) {
        var $ = core.$;
        var ui = core.ui;
        var cs = core.cs;
        var pathMod = core.node.path;
        var fsMod = core.node.fs;
        var cp = core.node.cp;
        var U = global.BHUpdater;
        var BH_VERSION = core.version;

        /** Dev installs ARE the git repo — update them with git pull, then reload. */
        function performDevUpdate(remoteVersion) {
            // getExtensionPath() returns the symlink under CEP/extensions —
            // resolve it to the real cep/ folder inside the repo first
            var realExt = cs.getExtensionPath();
            try { realExt = fsMod.realpathSync(realExt); } catch (e) { }
            var repoRoot = pathMod.join(realExt, "..");
            ui.confirm("This is a development install (linked to the git repo).\n\n" +
                       "Run git pull to update to v" + remoteVersion + " now?", "Dev Install Update")
                .then(function (yes) {
                    if (!yes) return;
                    core.busy(true);
                    core.toast("Running git pull…");
                    U.gitPull(repoRoot).then(function () {
                        core.busy(false);
                        core.toast("Updated — reloading panel…");
                        setTimeout(function () { location.reload(); }, 800);
                    }, function (e) {
                        core.busy(false);
                        if (e.spawnFailed) {
                            ui.alert("git pull could not start:\n" + e.message);
                        } else {
                            ui.alert("git pull failed:\n\n" + String(e.output || e.message).slice(-400) +
                                     "\n\nResolve it in Terminal (uncommitted changes?), then try again.");
                        }
                    });
                });
        }

        /**
         * Download the new signed package, verify its published SHA-256, extract
         * into a staging folder, validate, then atomically swap it into place
         * (all in BHUpdater.downloadAndInstall). The previous version is kept as
         * <install>.backup until the new version boots (see cleanupUpdateBackup).
         */
        function performAutoUpdate(remoteVersion) {
            var extPath = cs.getExtensionPath();
            if (U.isDevInstall(extPath)) {
                performDevUpdate(remoteVersion);
                return;
            }

            // System-wide installs (Program Files / /Library) aren't writable
            // without admin rights. Install to the per-user extensions folder
            // instead — CEP loads the highest version of a duplicated bundle ID,
            // so the user-folder copy takes over on next AE start.
            var targetPath = extPath;
            var sideInstall = false;
            if (!U.dirWritable(extPath)) {
                targetPath = pathMod.join(U.userExtensionsDir(), "com.bighappy.launcher");
                sideInstall = true;
                try { U.mkdirp(targetPath); } catch (e) {
                    ui.alert("Auto-update failed:\nCould not create " + targetPath + "\n" + e.message);
                    return;
                }
                if (!U.dirWritable(targetPath)) {
                    ui.alert("Auto-update failed:\nNo writable install location found.\n\n" +
                             "Install the new .zxp manually from GitHub (dist folder).");
                    return;
                }
            }

            core.busy(true);
            core.toast("Downloading v" + remoteVersion + "…");
            U.downloadAndInstall(remoteVersion, targetPath)
                .then(function () {
                    core.busy(false);
                    $("update-pill").classList.add("hidden");
                    return ui.alert("Updated to v" + remoteVersion + "!\n\n" +
                        (sideInstall
                            ? "Installed to your user extensions folder (the original install location needs admin rights). CEP loads the newest version automatically.\n\n"
                            : "") +
                        "Restart After Effects to finish — the new version loads on next launch.", "Update Installed");
                })
                .catch(function (err) {
                    core.busy(false);
                    ui.alert("Auto-update failed:\n" + err.message +
                        "\n\nYour current version was left untouched." +
                        "\nYou can update manually — the panel will open the GitHub page.").then(function () {
                        cp.spawn(global.BHFFmpeg.isWin ? "explorer" : "open", [core.repoUrl], { detached: true });
                    });
                });
        }

        /**
         * Runs once per boot: this panel version started successfully, so the
         * pre-update backup (kept for rollback) is no longer needed. Never touches
         * a backup that is NEWER than us — that would be the rollback source after
         * a failed update, not a leftover.
         */
        function cleanupUpdateBackup() {
            U.cleanupBackups(
                [cs.getExtensionPath(), pathMod.join(U.userExtensionsDir(), "com.bighappy.launcher")],
                BH_VERSION);
        }

        /**
         * Runs at every panel open and hourly after that — the manifest fetch is
         * tiny (and now carries a 30s timeout), and the once-per-version dialog
         * gate is what prevents nagging, so there is deliberately NO time throttle
         * (one would delay the push → open panel → see notification flow this
         * exists for).
         * @param {boolean} [force] - true for the manual Settings button: report
         *   every outcome (up to date / offline) and re-show the dialog even for
         *   an already-notified version.
         */
        function checkForUpdate(force) {
            U.fetchRemoteVersion()
                .then(function (remote) {
                    if (U.versionNewer(remote, BH_VERSION)) {
                        var pill = $("update-pill");
                        pill.textContent = "v" + remote + " available";
                        pill.classList.remove("hidden");
                        pill.onclick = function () {
                            ui.confirm("Version " + remote + " is available (you have " + BH_VERSION + ").\n\n" +
                                       "Download and install it now?\nAfter Effects must be restarted afterwards.",
                                       "Update Available")
                                .then(function (yes) { if (yes) performAutoUpdate(remote); });
                        };
                        // NOTIFY: open the install dialog automatically, but only
                        // once per version — declining leaves the pill as reminder
                        if (force || localStorage.getItem("bh.notifiedVersion") !== remote) {
                            localStorage.setItem("bh.notifiedVersion", remote);
                            pill.onclick();
                        }
                    } else if (force) {
                        ui.alert("You are up to date.\n\nInstalled: v" + BH_VERSION +
                                 "\nLatest on GitHub: v" + remote, "No Update Available");
                    }
                })
                .catch(function (err) {
                    if (force) ui.alert("Could not reach GitHub to check for updates.\n\n" +
                                        "Reason: " + ((err && err.message) || "unknown") +
                                        "\n\nCheck your internet connection and try again.");
                });
        }

        function showWhatsNew() {
            var seen = localStorage.getItem("bh.lastVersion");
            localStorage.setItem("bh.lastVersion", BH_VERSION);
            if (!seen || seen === BH_VERSION) return;   // fresh install or unchanged
            var notes = CHANGELOG[BH_VERSION];
            if (!notes) return;
            ui.alert("Updated to v" + BH_VERSION + "\n\n" +
                notes.map(function (n) { return "• " + n; }).join("\n"),
                "What's New");
        }

        $("btn-check-update").addEventListener("click", function () {
            checkForUpdate(true);
        });

        return {
            checkForUpdate: checkForUpdate,
            showWhatsNew: showWhatsNew,
            cleanupUpdateBackup: cleanupUpdateBackup
        };
    }

    global.BHUpdateUI = { init: init, CHANGELOG: CHANGELOG };
})(window);
