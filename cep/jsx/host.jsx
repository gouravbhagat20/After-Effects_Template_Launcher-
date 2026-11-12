/*
    BigHappy Launcher — CEP host bridge (ExtendScript)

    Loaded by the CEP panel (ScriptPath in manifest.xml). Exposes a small
    JSON-in/JSON-out API under the BH namespace. Everything that does NOT
    need the After Effects DOM (filesystem, ffmpeg, networking) lives in
    the panel's Node.js side, not here.

    Every public function returns a JSON string:
      { ok: true,  data: ... }
      { ok: false, error: "message" }
*/

var BH = (function () {

    // ---------- minimal JSON stringify (ExtendScript has no JSON) ----------

    function esc(s) {
        return String(s)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t")
            .replace(/[\u0000-\u001f]/g, "");
    }

    function stringify(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return String(v);
        if (t === "string") return '"' + esc(v) + '"';
        if (v instanceof Array) {
            var out = [];
            for (var i = 0; i < v.length; i++) out.push(stringify(v[i]));
            return "[" + out.join(",") + "]";
        }
        if (t === "object") {
            var props = [];
            for (var k in v) {
                if (v.hasOwnProperty(k)) props.push('"' + esc(k) + '":' + stringify(v[k]));
            }
            return "{" + props.join(",") + "}";
        }
        return "null";
    }

    function ok(data) { return stringify({ ok: true, data: data }); }
    function fail(msg) { return stringify({ ok: false, error: String(msg) }); }

    // ---------- helpers ----------

    function findMainComp() {
        var proj = app.project;
        if (!proj) return null;
        var candidates = [];
        for (var i = 1; i <= proj.numItems; i++) {
            var item = proj.item(i);
            if (item instanceof CompItem && /^main$/i.test(item.name)) candidates.push(item);
        }
        if (candidates.length > 0) return candidates[0];
        // Fallback: "Main" as a whole word in the name ("Main_v2", "01 Main").
        // A bare substring test also picked "Remaining" or "Domain_Intro" —
        // and that comp is what gets rendered.
        for (var j = 1; j <= proj.numItems; j++) {
            var it = proj.item(j);
            if (it instanceof CompItem && /(^|[^a-z0-9])main([^a-z0-9]|$)/i.test(it.name)) return it;
        }
        return null;
    }

    function isProjectDirty() {
        try { return app.project.dirty === true; }        // AE 17.5+
        catch (e) { return app.project.file === null && app.project.numItems > 0; }
    }

    // ---------- public API ----------

    var api = {};

    api.ping = function () {
        return ok({ app: app.appName || "AfterFX", version: app.version });
    };

    /** Snapshot of the open project for the panel's status area. */
    api.getProjectInfo = function () {
        try {
            var proj = app.project;
            if (!proj) return ok({ open: false });

            var main = findMainComp();
            var comps = 0, footage = 0;
            for (var i = 1; i <= proj.numItems; i++) {
                var it = proj.item(i);
                if (it instanceof CompItem) comps++;
                else if (it instanceof FootageItem) footage++;
            }

            return ok({
                open: true,
                name: proj.file ? decodeURI(proj.file.name).replace(/\.aep$/i, "") : null,
                path: proj.file ? proj.file.fsName : null,
                folder: proj.file ? proj.file.parent.fsName : null,
                dirty: isProjectDirty(),
                numComps: comps,
                numFootage: footage,
                mainComp: main ? {
                    name: main.name,
                    width: main.width,
                    height: main.height,
                    duration: main.duration,
                    fps: main.frameRate
                } : null
            });
        } catch (e) { return fail(e); }
    };

    /**
     * Open a project. The panel asks the user about unsaved changes BEFORE
     * calling this (its dialogs are nicer); force=true skips the guard here.
     */
    api.openProject = function (path, force) {
        try {
            var f = new File(path);
            if (!f.exists) return fail("File not found: " + path);
            if (!force && app.project && app.project.numItems > 0 && isProjectDirty()) {
                return fail("UNSAVED_CHANGES");
            }
            app.open(f);
            return ok({ opened: f.fsName });
        } catch (e) { return fail(e); }
    };

    /** Save the current project (in place). */
    api.saveProject = function () {
        try {
            if (!app.project || !app.project.file) return fail("No saved project open.");
            app.project.save();
            return ok({ saved: app.project.file.fsName });
        } catch (e) { return fail(e); }
    };

    /** Save the current project to a new path (Save As). */
    api.saveProjectAs = function (path) {
        try {
            if (!app.project) return fail("No project open.");
            app.project.save(new File(path));
            return ok({ saved: app.project.file.fsName });
        } catch (e) { return fail(e); }
    };

    /**
     * List footage items that reference a file inside the given folder —
     * used by the optimizer so Node knows which files AE holds locks on.
     */
    api.getFootageIn = function (folderPath) {
        try {
            var out = [];
            var proj = app.project;
            if (!proj) return ok(out);
            // Compare with a trailing separator, or /work/job would also
            // claim everything under /work/job2.
            var norm = String(folderPath).toLowerCase().replace(/[\/\\]+$/, "");
            for (var i = 1; i <= proj.numItems; i++) {
                var it = proj.item(i);
                var fsLower = (it instanceof FootageItem && it.file) ? it.file.fsName.toLowerCase() : null;
                if (fsLower !== null &&
                    (fsLower.indexOf(norm + "/") === 0 || fsLower.indexOf(norm + "\\") === 0)) {
                    out.push({ index: i, name: it.name, path: it.file.fsName });
                }
            }
            return ok(out);
        } catch (e) { return fail(e); }
    };

    /** Name prefix stamped onto footage items parked by releaseFileLock. */
    var RELINK_PREFIX = "BH_RELINK_";

    /**
     * Release AE's lock on a file (point footage + render-queue output
     * modules at a temp placeholder) so ffmpeg/Node can replace it.
     * Returns tokens: { items: [{id, index, name}], oms: [{rq, om}] } —
     * pass them back to restoreFileLock() afterwards so BOTH footage and
     * render-queue output modules get restored.
     *
     * Items are identified by their persistent item.id, never by index alone:
     * parking renames the item, and AE's item indices follow Project-panel
     * order, so an index recorded before the rename can point at a different
     * item afterwards. The placeholder name carries the id too, which is what
     * lets recoverPlaceholders() match an orphan to its saved original name.
     */
    api.releaseFileLock = function (path) {
        try {
            var tokens = { items: [], oms: [], failed: [] };
            var proj = app.project;
            if (!proj) return ok(tokens);
            var target = new File(path);
            // Case-insensitive compare — Windows paths can differ only in
            // case (same normalization getFootageIn uses); an exact compare
            // left such items locked and the file swap failing.
            var targetNorm = target.fsName.toLowerCase();
            var stamp = String(new Date().getTime());

            var rq = proj.renderQueue;
            for (var i = 1; i <= rq.numItems; i++) {
                for (var j = 1; j <= rq.item(i).numOutputModules; j++) {
                    var omMatched = false;
                    try {
                        var om = rq.item(i).outputModule(j);
                        if (om.file && om.file.fsName.toLowerCase() === targetNorm) {
                            omMatched = true;
                            om.file = new File(Folder.temp.fsName + "/bh_lock_" + stamp + "_" + i + "_" + j + ".mp4");
                            tokens.oms.push({ rq: i, om: j });
                        }
                    } catch (eOm) {
                        // only report modules we KNOW reference the target
                        if (omMatched) tokens.failed.push("render queue item " + i + " output " + j);
                    }
                }
            }
            // Find every match BEFORE parking any of them — parking renames
            // items, and a rename mid-scan can reorder the very list being
            // walked (skipping one item, visiting another twice).
            var matches = [];
            for (var k = 1; k <= proj.numItems; k++) {
                try {
                    var cand = proj.item(k);
                    if (cand instanceof FootageItem && cand.file &&
                        cand.file.fsName.toLowerCase() === targetNorm) {
                        matches.push({ item: cand, index: k });
                    }
                } catch (eScan) { /* unreadable item cannot be a known match */ }
            }
            for (var m = 0; m < matches.length; m++) {
                // Per-item try: one bad item must not leave the rest locked
                var itName = null;
                try {
                    var it = matches[m].item;
                    itName = it.name;
                    // replace() throws when the target file doesn't exist on
                    // disk — use AE's built-in placeholder instead, clamped
                    // to its documented limits (fps 1-99, duration <= 10800,
                    // dimensions 4-30000). Keep the item name: the
                    // placeholder renames it and replace() won't rename back.
                    var phW = it.width > 0 ? it.width : 1920;
                    if (phW < 4) phW = 4; if (phW > 30000) phW = 30000;
                    var phH = it.height > 0 ? it.height : 1080;
                    if (phH < 4) phH = 4; if (phH > 30000) phH = 30000;
                    var phFps = it.frameRate > 0 ? it.frameRate : 30;
                    if (phFps < 1) phFps = 1; if (phFps > 99) phFps = 99;
                    var phDur = it.duration > 0 ? it.duration : 1;
                    if (phDur > 10800) phDur = 10800;
                    var keepName = it.name;
                    var keepId = it.id;
                    it.replaceWithPlaceholder(RELINK_PREFIX + keepId, phW, phH, phFps, phDur);
                    tokens.items.push({ id: keepId, index: matches[m].index, name: keepName });
                } catch (eItem) {
                    // only report items we KNOW reference the target file
                    if (itName !== null) tokens.failed.push(itName);
                }
            }
            return ok(tokens);
        } catch (e) { return fail(e); }
    };

    /**
     * The footage item a release token refers to, or null.
     *
     * By id when the token has one. Tokens saved by an older panel carry only
     * an index; that is trusted only while the item sitting there still has
     * the placeholder name that index was stamped with — otherwise the index
     * has drifted and relinking it would repoint somebody else's footage.
     */
    function itemForToken(rec) {
        var isRec = rec && typeof rec === "object";
        var it = null;
        if (isRec && rec.id !== undefined && rec.id !== null) {
            try { it = app.project.itemByID(rec.id); } catch (eId) { it = null; }
            return (it instanceof FootageItem) ? it : null;
        }
        var idx = isRec ? rec.index : rec;
        try { it = app.project.item(idx); } catch (eIdx) { it = null; }
        if (!(it instanceof FootageItem)) return null;
        // {index, name} came from a release: the placeholder name is checkable.
        // A bare index (stale panel page) carries nothing to check against.
        if (isRec && String(it.name) !== RELINK_PREFIX + idx) return null;
        return it;
    }

    /** Restore everything released by releaseFileLock to the given path.
        Items that fail to relink stay as BH_RELINK_* placeholders — their
        names are returned in `failed` so the panel can warn the user. */
    api.restoreFileLock = function (tokens, path) {
        try {
            var f = new File(path);
            var done = 0;
            var failed = [];
            var items = (tokens && tokens.items) || [];
            var oms = (tokens && tokens.oms) || [];
            for (var i = 0; i < items.length; i++) {
                // tokens.items entries are {id, index, name}; tolerate the
                // older {index, name} and bare-index shapes (see itemForToken)
                var rec = items[i];
                var idx = (rec && typeof rec === "object") ? rec.index : rec;
                var label = (rec && typeof rec === "object" && rec.name)
                    ? rec.name : ("footage item #" + idx);
                try {
                    var it = itemForToken(rec);
                    if (it) {
                        it.replace(f);
                        if (rec && typeof rec === "object" && rec.name) it.name = rec.name;
                        done++;
                    } else {
                        failed.push(label);
                    }
                } catch (e) {
                    failed.push(label);
                }
            }
            for (var j = 0; j < oms.length; j++) {
                try {
                    app.project.renderQueue.item(oms[j].rq).outputModule(oms[j].om).file = f;
                    done++;
                } catch (e) {
                    failed.push("render queue item " + oms[j].rq + " output " + oms[j].om);
                }
            }
            return ok({ restored: done, failed: failed });
        } catch (e) { return fail(e); }
    };

    /**
     * Footage items still parked as BH_RELINK_* placeholders.
     *
     * A complete optimize round-trip leaves none behind — restoreFileLock
     * relinks everything releaseFileLock parked. Any item that shows up here
     * is the residue of an INTERRUPTED run (panel closed, AE quit, or the
     * encode crashed between release and restore). Before this existed such
     * footage was stranded as a placeholder with no route back except a
     * manual relink the user had to figure out themselves.
     */
    api.findRelinkPlaceholders = function () {
        try {
            var out = [];
            var proj = app.project;
            if (!proj) return ok(out);
            for (var i = 1; i <= proj.numItems; i++) {
                try {
                    var it = proj.item(i);
                    if (it instanceof FootageItem && String(it.name).indexOf(RELINK_PREFIX) === 0) {
                        out.push({ index: i, name: it.name });
                    }
                } catch (eItem) { /* skip unreadable item, keep scanning */ }
            }
            return ok(out);
        } catch (e) { return fail(e); }
    };

    /**
     * Point every stranded BH_RELINK_* placeholder back at `path` — the
     * panel's boot-time recovery sweep.
     *
     * `tokens` is the record the panel saved before releasing, when it still
     * has it: its items carry the ORIGINAL names so they can be restored
     * exactly. Without it (the record is lost if AE died before the panel
     * could persist it) the items are still relinked, but take the
     * replacement file's name — recoverable footage beats a pristine name.
     */
    api.recoverPlaceholders = function (path, tokens) {
        try {
            var f = new File(path);
            if (!f.exists) return fail("File not found: " + path);

            var named = {};
            var recorded = (tokens && tokens.items) || [];
            for (var t = 0; t < recorded.length; t++) {
                var rec = recorded[t];
                // Keyed by the suffix the placeholder name was stamped with:
                // the item id, or the index for tokens from an older panel.
                if (rec && typeof rec === "object" && rec.name) {
                    named[(rec.id !== undefined && rec.id !== null) ? rec.id : rec.index] = rec.name;
                }
            }

            var restored = 0;
            var failed = [];
            var proj = app.project;
            if (!proj) return ok({ restored: 0, failed: failed });
            for (var i = 1; i <= proj.numItems; i++) {
                var label = null;
                try {
                    var it = proj.item(i);
                    if (!(it instanceof FootageItem)) continue;
                    if (String(it.name).indexOf(RELINK_PREFIX) !== 0) continue;
                    label = it.name;
                    var suffix = String(it.name).substring(RELINK_PREFIX.length);
                    it.replace(f);
                    if (named[suffix]) it.name = named[suffix];
                    restored++;
                } catch (eItem) {
                    if (label !== null) failed.push(label);
                }
            }
            return ok({ restored: restored, failed: failed });
        } catch (e) { return fail(e); }
    };

    // ---------- render queue ----------

    /**
     * Add the Main comp to the Render Queue with template-specific output
     * settings — exact port of the ScriptUI addToRenderQueue.
     * outputPath has no extension (the output module appends it).
     */
    api.addMainToRenderQueue = function (outputPath, templateType) {
        try {
            var comp = findMainComp();
            if (!comp) return fail("Main composition not found (BH-3001).");

            var rqItem = app.project.renderQueue.items.add(comp);
            var om = rqItem.outputModule(1);
            // Must agree with the panel's own format/folder choice in
            // tab-render.js (and the script's CONFIG.RENDER_FORMATS): only
            // Sunrise and unrecognised sizes are PNG sequences. Expandable
            // used to fall through to PNG here while the panel routed it to
            // the MP4 folder.
            var isPng = !(templateType === "interscroller" || templateType === "expandable" ||
                          String(templateType).indexOf("dooh") !== -1);

            try {
                om.applyTemplate(isPng ? "PNG Sequence with Alpha" : "H.264");
            } catch (templateErr) {
                try {
                    om.applyTemplate(isPng ? "PNG Sequence" : "H.264 - Match Render Settings - 15 Mbps");
                } catch (fallbackErr) { }
            }

            if (templateType === "sunrise") {
                try {
                    var pngSettings = {
                        "Format": "PNG Sequence",
                        "Video Output": {
                            "Channels": "RGB + Alpha",
                            "Depth": "Millions of Colors+",
                            "Color": "Straight (Unmatted)"
                        }
                    };
                    try { om.setSettings(pngSettings); }
                    catch (e1) {
                        pngSettings["Video Output"]["Color"] = "Straight";
                        om.setSettings(pngSettings);
                    }
                } catch (e) { }
            } else if (!isPng) {
                try {
                    om.setSettings({
                        "Format": "H.264",
                        "Video Output": {
                            "Format Options": { "Profile": "High", "Level": "5.1", "Target Bitrate (Mbps)": 15 }
                        }
                    });
                } catch (e) {
                    try { om.setSettings({ "Format": "QuickTime" }); } catch (err2) { }
                }
            }

            om.file = new File(outputPath);
            return ok({ comp: comp.name, canAME: canQueueInAME() });
        } catch (e) { return fail(e); }
    };

    function canQueueInAME() {
        try { return typeof app.project.renderQueue.queueInAME === "function"; }
        catch (e) { return false; }
    }

    /** Send the queue to Adobe Media Encoder and start rendering. */
    api.queueToAME = function () {
        try {
            if (!canQueueInAME()) return fail("Adobe Media Encoder not available (BH-3003).");
            app.project.renderQueue.queueInAME(true);
            return ok(true);
        } catch (e) { return fail(e); }
    };

    // ---------- collect ----------

    /** List missing footage files (pre-flight before collecting). */
    api.preFlightCheck = function () {
        try {
            var missing = [];
            var items = app.project.items;
            for (var i = 1; i <= items.length; i++) {
                var item = items[i];
                if (item instanceof FootageItem && item.file && !item.file.exists) {
                    missing.push(item.name + " → " + item.file.fsName);
                }
            }
            return ok(missing);
        } catch (e) { return fail(e); }
    };

    /**
     * Collect: save original untouched, Save As a copy at destAepPath, copy
     * all linked footage into footageFolderPath (relinking the COPY), save,
     * and write _Pack_Report.txt. Port of the script's local collect path —
     * the original project on disk is never modified.
     *
     * Save As leaves AE working in the COPY, so the last step reopens the
     * original (as the script does). Without it every later edit and render
     * silently lands in the collect folder. `reopened` tells the panel
     * whether that worked; on a failure part-way through, the half-relinked
     * copy is closed unsaved and the original reopened too.
     *
     * Two ways in, one implementation:
     *   collectProject(dest, footage)        — everything in one call
     *   collectBegin → collectStep… → collectFinish   (or collectAbort)
     * The stepped form is what the panel uses: one long call freezes AE with
     * no progress and cannot be cancelled, so it does a slice of the work per
     * call and the panel shows progress, and can stop, in between.
     */
    var collectState = null;

    function collectBeginImpl(destAepPath, footageFolderPath) {
        if (!app.project || !app.project.file) throw new Error("No saved project open (BH-2003).");

        app.project.save();                          // original, unmodified
        var st = {
            originalFile: new File(app.project.file.fsName),
            onCopy: false,
            destAepPath: destAepPath,
            footageFolder: new Folder(footageFolderPath),
            missing: [],
            queue: [],        // ids of the footage items to copy + relink
            pos: 0,
            count: 0,
            claimed: {},      // dest path (lower-cased) -> source path, files written this run
            singles: {},      // source path -> File it was copied to
            sequences: {}     // sequence identity -> Folder its frames were copied to
        };
        collectState = st;

        app.project.save(new File(destAepPath));     // now working on the copy
        st.onCopy = true;
        st.copyFsName = app.project.file ? app.project.file.fsName : new File(destAepPath).fsName;

        if (!st.footageFolder.exists) st.footageFolder.create();

        // Queue by item.id, not index: relinking renames an item to its new
        // file's name, and a rename can renumber the list being walked.
        var items = app.project.items;
        for (var m = 1; m <= items.length; m++) {
            var it = items[m];
            if (!it || !(it instanceof FootageItem) || !it.file) continue;
            if (!it.file.exists) {
                st.missing.push(it.name + " → " + it.file.fsName);
                continue;
            }
            if (!it.mainSource || it.mainSource instanceof SolidSource) continue;
            st.queue.push(it.id);
        }
        return st;
    }

    /** Copy + relink queued items until the queue is empty or `budgetMs` is
        spent (always at least one item). budgetMs <= 0 means no limit. */
    function collectRun(st, budgetMs) {
        var t0 = new Date().getTime();
        while (st.pos < st.queue.length) {
            var item = app.project.itemByID(st.queue[st.pos]);
            st.pos++;
            collectOne(item, st);
            if (budgetMs > 0 && new Date().getTime() - t0 >= budgetMs) break;
        }
    }

    function collectFinishImpl(st) {
        app.project.save();                          // persist relinks in the copy
        generatePackReport(new File(st.destAepPath).parent, st.missing);
        var reopened = reopenOriginal(st.originalFile, false);
        collectState = null;
        return { assets: st.count, missing: st.missing.length, reopened: reopened };
    }

    /** Give up on a collect: leave the copy (unsaved) and go back to the
        original. Returns whether the original is open again. */
    function collectAbortImpl() {
        var st = collectState;
        collectState = null;
        if (!st || !st.onCopy) return true;          // never left the original
        return reopenOriginal(st.originalFile, true);
    }

    var STILL_ON_COPY = " — After Effects is still showing the collected COPY; " +
                        "reopen your original project before continuing.";

    api.collectProject = function (destAepPath, footageFolderPath) {
        try {
            var st = collectBeginImpl(destAepPath, footageFolderPath);
            collectRun(st, 0);
            return ok(collectFinishImpl(st));
        } catch (e) {
            return fail(collectAbortImpl() ? e : e + STILL_ON_COPY);
        }
    };

    /** Start a stepped collect. Returns { total, missing } — total is the
        number of footage items collectStep will work through. */
    api.collectBegin = function (destAepPath, footageFolderPath) {
        try {
            if (collectState) collectAbortImpl();    // a previous run the panel walked away from
            var st = collectBeginImpl(destAepPath, footageFolderPath);
            return ok({ total: st.queue.length, missing: st.missing.length });
        } catch (e) {
            return fail(collectAbortImpl() ? e : e + STILL_ON_COPY);
        }
    };

    /** Do up to budgetMs (default 250) of copying. Returns { done, total,
        finished }. On failure the collect is abandoned and the original
        reopened, exactly as in the one-call form. */
    api.collectStep = function (budgetMs) {
        try {
            var st = collectState;
            if (!st) return fail("No collect in progress.");
            // AE is usable between steps. If the user has since opened or
            // closed a project, relinking "the copy" would edit something else.
            var open = app.project && app.project.file ? app.project.file.fsName : null;
            if (open === null || open.toLowerCase() !== st.copyFsName.toLowerCase()) {
                collectState = null;
                return fail("The project was changed in After Effects while it was being collected — " +
                            "collect stopped. Nothing was changed in the project that is open now.");
            }
            collectRun(st, budgetMs > 0 ? budgetMs : 250);
            return ok({ done: st.pos, total: st.queue.length, finished: st.pos >= st.queue.length });
        } catch (e) {
            return fail(collectAbortImpl() ? e : e + STILL_ON_COPY);
        }
    };

    api.collectFinish = function () {
        try {
            if (!collectState) return fail("No collect in progress.");
            return ok(collectFinishImpl(collectState));
        } catch (e) {
            return fail(collectAbortImpl() ? e : e + STILL_ON_COPY);
        }
    };

    /** Cancel a stepped collect. Returns { reopened }. Files already copied
        stay in the collect folder; the copied .aep is left as Save As wrote it. */
    api.collectAbort = function () {
        try { return ok({ reopened: collectAbortImpl() }); }
        catch (e) { return fail(e); }
    };

    /** Leave the collected copy and reopen the original project. The copy is
        already saved on the success path; `discard` closes it unsaved first
        (failure path) so AE cannot stop on a "save changes?" prompt. */
    function reopenOriginal(originalFile, discard) {
        try {
            if (!originalFile || !originalFile.exists) return false;
            if (discard) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            app.open(originalFile);
            return true;
        } catch (e) { return false; }
    }

    /**
     * Copy one footage item's file(s) into the collect folder and relink it.
     * Port of collectAssets (no palette UI — the panel shows progress), with
     * the name-clash handling the port was missing:
     *
     *  - Two DIFFERENT sources with the same file name never share one copy.
     *    Single files get a _1/_2 suffix; an image sequence whose frame names
     *    are already taken goes into its own subfolder. (Sequences used to
     *    skip any frame that already existed, so a second "frame_0001.png…"
     *    sequence was silently relinked to the first one's frames.)
     *  - The SAME source used by several items is copied once and shared.
     *  - A sequence is the files named <prefix><digits>.<ext>, nothing looser:
     *    the old prefix test swept in every file starting with those letters.
     */
    function collectOne(item, st) {
        var footageFolder = st.footageFolder;
        var claimed = st.claimed;

        function claimKey(folder, name) {
            return (folder.fsName + "/" + name).toLowerCase();
        }

        if (!item || !(item instanceof FootageItem) || !item.file) return;
        if (!item.mainSource || item.mainSource instanceof SolidSource) return;
        var sourceFile = item.file;
        if (!sourceFile.exists) return;

        var destName = decodeURI(sourceFile.name);
        var lowerExt = sourceFile.name.split(".").pop().toLowerCase();

        var isSequence = !item.mainSource.isStill &&
            /^(png|jpg|jpeg|tif|tiff|tga|exr|psd)$/.test(lowerExt);

        if (isSequence) {
            var seqFolder = sourceFile.parent;
            if (!seqFolder || !seqFolder.exists) return;
            var match = destName.replace(/\.[^\.]+$/, "").match(/^(.*?)(\d+)$/);
            var seqFiles = match ? sequenceFiles(seqFolder, match[1].toLowerCase(), lowerExt) : null;

            if (seqFiles && seqFiles.length > 0) {
                var seqKey = (seqFolder.fsName + "|" + match[1] + "|" + lowerExt).toLowerCase();
                var destDir = st.sequences[seqKey];
                if (!destDir) {
                    destDir = footageFolder;
                    // Would any frame land on a name another source already took?
                    var clash = false;
                    for (var c = 0; c < seqFiles.length && !clash; c++) {
                        var taken = claimed[claimKey(destDir, decodeURI(seqFiles[c].name))];
                        if (taken && taken !== seqFiles[c].fsName) clash = true;
                    }
                    if (clash) {
                        var n = 2;
                        do {
                            destDir = new Folder(footageFolder.fsName + "/" +
                                decodeURI(seqFolder.name) + "_" + n);
                            n++;
                        } while (destDir.exists);
                        destDir.create();
                    }
                    var allCopied = true;
                    for (var f = 0; f < seqFiles.length; f++) {
                        var frameName = decodeURI(seqFiles[f].name);
                        if (seqFiles[f].copy(destDir.fsName + "/" + frameName)) {
                            claimed[claimKey(destDir, frameName)] = seqFiles[f].fsName;
                        } else {
                            allCopied = false;
                        }
                    }
                    if (!allCopied) return;         // leave the item on its original files
                    st.sequences[seqKey] = destDir;
                }
                var seqDest = new File(destDir.fsName + "/" + destName);
                var replaced = false;
                try {
                    if (typeof item.replaceWithSequence === "function") {
                        item.replaceWithSequence(seqDest, false);
                        replaced = true;
                    }
                } catch (errSeq) { }
                if (!replaced) item.replace(seqDest);
                st.count++;
                return;
            }
        }

        // single file (or a "sequence" with no numbered frames)
        var destFile = st.singles[sourceFile.fsName];
        if (!destFile) {
            destFile = new File(footageFolder.fsName + "/" + destName);
            var dupIdx = 1;
            var parts = destName.split(".");
            var fileExt = parts.pop();
            var base = parts.join(".");
            while (destFile.exists) {
                destFile = new File(footageFolder.fsName + "/" + base + "_" + dupIdx + "." + fileExt);
                dupIdx++;
            }
            sourceFile.copy(destFile.fsName);
            st.singles[sourceFile.fsName] = destFile;
            claimed[destFile.fsName.toLowerCase()] = sourceFile.fsName;
        }
        item.replace(destFile);
        st.count++;
    }

    /** The frames of one sequence: files in `folder` named exactly
        <prefix><digits>.<ext> (case-insensitive). */
    function sequenceFiles(folder, lowerPrefix, lowerExt) {
        var tail = "." + lowerExt;
        return folder.getFiles(function (f) {
            if (f instanceof Folder) return false;
            var name = decodeURI(f.name).toLowerCase();
            if (name.indexOf(lowerPrefix) !== 0) return false;
            if (name.length <= lowerPrefix.length + tail.length) return false;
            if (name.substring(name.length - tail.length) !== tail) return false;
            return /^\d+$/.test(name.substring(lowerPrefix.length, name.length - tail.length));
        });
    }

    function generatePackReport(destFolder, missingList) {
        try {
            var report = "=== PACK REPORT ===\n";
            report += "Generated: " + new Date().toLocaleString() + "\n";
            report += "Project: " + (app.project.file ? decodeURI(app.project.file.name) : "Untitled") + "\n\n";

            report += "--- MISSING FILES (" + missingList.length + ") ---\n";
            report += missingList.length === 0 ? "(None - All files found!)\n" : "";
            for (var i = 0; i < missingList.length; i++) report += "• " + missingList[i] + "\n";

            var fonts = getFontsUsed();
            report += "\n--- FONTS USED (" + fonts.length + ") ---\n";
            report += fonts.length === 0 ? "(No text layers found)\n" : "";
            for (var j = 0; j < fonts.length; j++) report += "• " + fonts[j] + "\n";

            var effects = getEffectsUsed();
            report += "\n--- EFFECTS/PLUGINS (" + effects.length + ") ---\n";
            report += effects.length === 0 ? "(No effects applied)\n" : "";
            for (var k = 0; k < effects.length; k++) report += "• " + effects[k] + "\n";

            var reportFile = new File(destFolder.fsName + "/_Pack_Report.txt");
            reportFile.encoding = "UTF-8";
            reportFile.open("w");
            reportFile.write(report);
            reportFile.close();
            return true;
        } catch (e) { return false; }
    }

    function getFontsUsed() {
        var fonts = {};
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (!(it instanceof CompItem)) continue;
                for (var L = 1; L <= it.numLayers; L++) {
                    var layer = it.layer(L);
                    try {
                        if (layer.property("Source Text")) {
                            var doc = layer.property("Source Text").value;
                            if (doc && doc.font) fonts[doc.font] = true;
                        }
                    } catch (e) { }
                }
            }
        } catch (e) { }
        var out = [];
        for (var f in fonts) if (fonts.hasOwnProperty(f)) out.push(f);
        return out;
    }

    function getEffectsUsed() {
        var fx = {};
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (!(it instanceof CompItem)) continue;
                for (var L = 1; L <= it.numLayers; L++) {
                    try {
                        var effects = it.layer(L).property("ADBE Effect Parade");
                        if (!effects) continue;
                        for (var e2 = 1; e2 <= effects.numProperties; e2++) {
                            fx[effects.property(e2).name] = true;
                        }
                    } catch (e) { }
                }
            }
        } catch (e) { }
        var out = [];
        for (var k in fx) if (fx.hasOwnProperty(k)) out.push(k);
        return out;
    }

    // ---------- settings shared with BigHappyLauncher_Templates.jsx ----------

    var SETTINGS_SECTION = "BigHappyLauncher";

    /** Read a setting from the SAME store the ScriptUI version uses. */
    api.getSetting = function (key, defaultVal) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                return ok(app.settings.getSetting(SETTINGS_SECTION, key));
            }
        } catch (e) { }
        return ok(defaultVal === undefined ? null : defaultVal);
    };

    api.setSetting = function (key, value) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, key, String(value));
            return ok(true);
        } catch (e) { return fail(e); }
    };

    // ---------- templates ----------

    /**
     * Create a new project from a template — exact port of the ScriptUI
     * create flow: open template, Save As into the project structure,
     * open Main in the viewer, import _GlobalAssets.
     * The panel handles the unsaved-changes guard and passes force=true.
     */
    api.createFromTemplate = function (templatePath, savePath, force) {
        try {
            var t = new File(templatePath);
            if (!t.exists) return fail("Template file not found: " + templatePath);
            if (!force && app.project && app.project.numItems > 0 && isProjectDirty()) {
                return fail("UNSAVED_CHANGES");
            }

            app.open(t);
            app.project.save(new File(savePath));

            var mainComp = findMainComp();
            if (mainComp) mainComp.openInViewer();

            var globalAssets = importGlobalAssets();

            return ok({ saved: app.project.file.fsName, globalAssets: globalAssets });
        } catch (e) { return fail(e); }
    };

    /**
     * Generate a placeholder template .aep — exact port of the ScriptUI
     * generateTemplateFile: Screens/png/Image/Comps bins, a Main comp, and
     * two red centered text layers. Closes the current project WITHOUT
     * saving — the panel runs its unsaved-changes guard first.
     */
    api.generateTemplate = function (name, width, height, fps, duration, folderPath) {
        var undoOpen = false;
        try {
            // Strip path separators / traversal so the name can't escape folderPath
            name = String(name).replace(/[<>:"\/\\|?*]/g, "").replace(/\.\./g, "").replace(/^\s+|\s+$/g, "");
            if (!name) name = "Template";

            if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            app.newProject();
            app.beginUndoGroup("Generate Template: " + name);
            undoOpen = true;

            app.project.items.addFolder("Screens");
            app.project.items.addFolder("png");
            app.project.items.addFolder("Image");
            var compsFolder = app.project.items.addFolder("Comps");

            var mainComp = app.project.items.addComp("Main", width, height, 1, duration, fps);
            mainComp.parentFolder = compsFolder;

            addCenteredText(mainComp, name, width / 2, height / 2 - 35);
            addCenteredText(mainComp, width + "x" + height + " | " + fps + "fps | " + duration + "s",
                width / 2, height / 2 + 35);

            var fileName = name.replace(/\s+/g, "_") + "_" + width + "x" + height + ".aep";
            var filePath = folderPath + "/" + fileName;

            app.endUndoGroup();
            undoOpen = false;
            app.project.save(new File(filePath));
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

            return ok({ path: new File(filePath).fsName });
        } catch (e) {
            if (undoOpen) { try { app.endUndoGroup(); } catch (e2) { } }
            return fail(e);
        }
    };

    function addCenteredText(comp, text, x, y) {
        var layer = comp.layers.addText(text);
        try {
            var prop = layer.property("Source Text");
            var doc = prop.value;
            doc.fontSize = 55;
            doc.tracking = -10;
            doc.justification = ParagraphJustification.CENTER_JUSTIFY;
            doc.fillColor = [1, 0, 0];
            prop.setValue(doc);
        } catch (e) { }
        layer.property("Position").setValue([x, y]);
    }

    /** Port of importGlobalAssets: pull templatesFolder/_GlobalAssets into a
        00_Global_Assets bin. Returns { imported, failed: [fileNames], error? }
        so a partial import no longer looks like a clean success. */
    function importGlobalAssets() {
        var result = { imported: 0, failed: [] };
        try {
            var templatesFolder = null;
            if (app.settings.haveSetting(SETTINGS_SECTION, "templates_folder")) {
                templatesFolder = app.settings.getSetting(SETTINGS_SECTION, "templates_folder");
            } else {
                templatesFolder = Folder.myDocuments.fsName + "/BH_Templates";
            }
            var folder = new Folder(templatesFolder + "/_GlobalAssets");
            if (!folder.exists) return result;

            var files = folder.getFiles();
            if (!files || files.length === 0) return result;

            var binName = "00_Global_Assets";
            var bin = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof FolderItem && item.name === binName) { bin = item; break; }
            }
            if (!bin) bin = app.project.items.addFolder(binName);

            for (var f = 0; f < files.length; f++) {
                var fileObj = files[f];
                if (!(fileObj instanceof File) || fileObj.name.indexOf(".") === 0) continue;
                try {
                    var io = new ImportOptions(fileObj);
                    if (io.canImportAs(ImportAsType.FOOTAGE)) {
                        app.project.importFile(io).parentFolder = bin;
                        result.imported++;
                    }
                } catch (impErr) {
                    result.failed.push(decodeURI(fileObj.name));
                }
            }
        } catch (e) {
            // whole-import failure (bin creation, folder listing, …)
            result.error = String(e);
        }
        return result;
    }

    return api;
})();
