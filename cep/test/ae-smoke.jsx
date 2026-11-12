/*
    BigHappy Launcher — smoke test that runs INSIDE After Effects.

    The Node test suite drives jsx/host.jsx against a mock of the AE DOM, so
    it can only prove the logic around AE's API, never the API itself. This
    script runs the same host calls against the real thing, on a throwaway
    project in the temp folder.

    How to run:
        After Effects → File → Scripts → Run Script File… → this file.
        (Preferences → Scripting & Expressions → "Allow Scripts to Write
        Files and Access Network" must be on.)

    What it does:
        1. file-lock round trip  — release + restore a footage item, and
           reports whether AE really renumbers items when one is renamed
        2. render queue          — queues Main for each template type and
           checks the output format AE ends up with
        3. collect               — collects the project and checks AE is back
           on the original afterwards, with same-named files kept apart

    It refuses to start while the open project has unsaved changes, closes
    that project (reopening it at the end), and never touches your files:
    everything it creates lives under one bh_smoke_* folder in the temp dir.

    Not part of the packaged .zxp (cep/test is excluded) and not run by CI.
*/
(function () {

    var results = [];
    var counts = { PASS: 0, FAIL: 0, INFO: 0 };

    function record(status, name, detail) {
        counts[status]++;
        results.push(status + "  " + name + (detail ? "\n        " + detail : ""));
    }
    function check(name, cond, detail) { record(cond ? "PASS" : "FAIL", name, detail); }

    /** Run one section; an exception fails it without stopping the rest. */
    function section(title, fn) {
        results.push("");
        results.push("== " + title + " ==");
        try { fn(); }
        catch (e) { record("FAIL", title + " threw", String(e) + (e.line ? " (line " + e.line + ")" : "")); }
    }

    /** Unwrap a BH.* JSON envelope (ExtendScript has no JSON.parse). */
    function unwrap(raw) {
        var parsed = eval("(" + raw + ")");
        if (!parsed.ok) throw new Error("host call failed: " + parsed.error);
        return parsed.data;
    }

    function samePath(a, b) {
        return new File(a).fsName.toLowerCase() === new File(b).fsName.toLowerCase();
    }

    /** Current 1-based index of the item with this id, or 0. */
    function indexOfId(id) {
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).id === id) return i;
        }
        return 0;
    }

    // A 16x16 opaque red PNG — real footage AE can import, with no render needed.
    var PNG_HEX = "89504e470d0a1a0a0000000d49484452000000100000001008060000001ff3ff61" +
                  "000000194944415478da63f8cfc0f09f12cc306ac0a801a3060c17030030c4fe10" +
                  "8ac64ce50000000049454e44ae426082";

    function writePng(path) {
        var f = new File(path);
        if (!f.parent.exists) f.parent.create();
        f.encoding = "BINARY";
        if (!f.open("w")) throw new Error("cannot write " + path + " — is \"Allow Scripts to Write Files\" enabled?");
        var bin = "";
        for (var i = 0; i < PNG_HEX.length; i += 2) {
            bin += String.fromCharCode(parseInt(PNG_HEX.substr(i, 2), 16));
        }
        f.write(bin);
        f.close();
        return f;
    }

    function importStill(file, name) {
        var item = app.project.importFile(new ImportOptions(file));
        if (name) item.name = name;
        return item;
    }

    // ------------------------------------------------------------ preflight

    if (app.project && app.project.numItems > 0) {
        var dirty = false;
        try { dirty = app.project.dirty === true; } catch (eDirty) { dirty = true; }
        if (dirty) {
            alert("BigHappy smoke test\n\nThe open project has unsaved changes. Save or close it, then run this again.");
            return;
        }
    }
    if (!confirm("BigHappy smoke test\n\nThis closes the current project (it is saved, and is reopened " +
                 "afterwards) and runs the launcher's host functions on a throwaway project in the " +
                 "temp folder.\n\nContinue?")) {
        return;
    }

    var previousProject = (app.project && app.project.file) ? new File(app.project.file.fsName) : null;

    var hostFile = new File(new File($.fileName).parent.parent.fsName + "/jsx/host.jsx");
    if (!hostFile.exists) { alert("host.jsx not found at:\n" + hostFile.fsName); return; }
    $.evalFile(hostFile);
    if (typeof BH === "undefined") { alert("host.jsx loaded but did not define BH."); return; }

    var work = new Folder(Folder.temp.fsName + "/bh_smoke_" + new Date().getTime());
    work.create();

    results.push("BigHappy Launcher smoke test");
    results.push("After Effects " + app.version + " — " + new Date().toString());
    results.push("Work folder: " + work.fsName);

    try { if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (eClose) { }
    app.newProject();

    // ------------------------------------------------- 1. file-lock round trip

    section("File-lock round trip (optimizer)", function () {
        var cherryFile = writePng(work.fsName + "/src/Cherry.png");
        var zebraFile = writePng(work.fsName + "/src/Zebra.png");
        var cherry = importStill(cherryFile, "Cherry");
        var zebra = importStill(zebraFile, "Zebra");
        var zebraId = zebra.id;
        var before = indexOfId(zebraId);

        var tokens = unwrap(BH.releaseFileLock(zebraFile.fsName));
        check("release finds the one item on the file", tokens.items.length === 1,
              "items: " + tokens.items.length + ", failed: " + tokens.failed.length);
        check("the token carries the item's id", tokens.items.length === 1 && tokens.items[0].id === zebraId);

        var during = indexOfId(zebraId);
        record("INFO", "Does renaming an item change its index in this AE?",
               (before !== during ? "YES" : "NO") + " — Zebra was item " + before + ", is item " + during +
               " while parked as " + app.project.itemByID(zebraId).name);
        check("one placeholder is visible while parked",
              unwrap(BH.findRelinkPlaceholders()).length === 1);

        var res = unwrap(BH.restoreFileLock(tokens, zebraFile.fsName));
        check("restore relinks one item with no failures", res.restored === 1 && res.failed.length === 0,
              "restored: " + res.restored + ", failed: " + res.failed.join(", "));
        var back = app.project.itemByID(zebraId);
        check("the parked item has its name back", back.name === "Zebra", "name is now: " + back.name);
        check("the parked item points at its file again",
              !!back.file && samePath(back.file.fsName, zebraFile.fsName),
              "file is now: " + (back.file ? back.file.fsName : "(none)"));
        check("the other item was not renamed", cherry.name === "Cherry", "name is now: " + cherry.name);
        check("the other item was not repointed",
              !!cherry.file && samePath(cherry.file.fsName, cherryFile.fsName),
              "file is now: " + (cherry.file ? cherry.file.fsName : "(none)"));
        check("no placeholders are left behind", unwrap(BH.findRelinkPlaceholders()).length === 0);
    });

    // -------------------------------------------------------- 2. render queue

    section("Render queue formats", function () {
        var comp = app.project.items.addComp("Main", 750, 300, 1, 2, 24);
        var cases = [
            { type: "sunrise", w: 750, h: 300, png: true },
            { type: "expandable", w: 750, h: 1334, png: false },
            { type: "interscroller", w: 880, h: 1912, png: false },
            { type: "dooh_horizontal", w: 1920, h: 1080, png: false }
        ];
        for (var c = 0; c < cases.length; c++) {
            var k = cases[c];
            comp.width = k.w;
            comp.height = k.h;
            unwrap(BH.addMainToRenderQueue(work.fsName + "/render_" + k.type, k.type));
            var rq = app.project.renderQueue;
            var item = rq.item(rq.numItems);
            var outName = decodeURI(item.outputModule(1).file.name);
            var isPng = /\.png$/i.test(outName);
            var isMp4 = /\.mp4$/i.test(outName);
            check(k.type + " queues as " + (k.png ? "a PNG sequence" : "H.264 MP4"),
                  k.png ? isPng : isMp4,
                  "output file: " + outName +
                  ((k.png ? isPng : isMp4) ? "" : " — the output-module template may be missing on this machine"));
            item.remove();
        }
        comp.remove();
    });

    // ------------------------------------------------------------- 3. collect

    section("Collect project", function () {
        var logoA = importStill(writePng(work.fsName + "/src/a/logo.png"), "logo A");
        var logoB = importStill(writePng(work.fsName + "/src/b/logo.png"), "logo B");
        var idA = logoA.id, idB = logoB.id;

        var orig = new File(work.fsName + "/orig.aep");
        app.project.save(orig);

        var destFolder = new Folder(work.fsName + "/collected");
        destFolder.create();
        var destAep = destFolder.fsName + "/orig.aep";
        var footage = destFolder.fsName + "/(Footage)";

        var res = unwrap(BH.collectProject(destAep, footage));
        check("collect reports the original was reopened", res.reopened === true);
        check("After Effects is back on the original project",
              !!app.project.file && samePath(app.project.file.fsName, orig.fsName),
              "open project: " + (app.project.file ? app.project.file.fsName : "(unsaved)"));
        check("the collected copy exists", new File(destAep).exists);
        check("the pack report was written", new File(destFolder.fsName + "/_Pack_Report.txt").exists);
        check("two different files named logo.png are kept apart",
              new File(footage + "/logo.png").exists && new File(footage + "/logo_1.png").exists);
        check("all four stills were collected", res.assets === 4, "assets: " + res.assets);

        // The original must still point at the original sources.
        var a = app.project.itemByID(idA), b = app.project.itemByID(idB);
        check("the original project still links to the original files",
              !!a.file && !!b.file &&
              samePath(a.file.fsName, work.fsName + "/src/a/logo.png") &&
              samePath(b.file.fsName, work.fsName + "/src/b/logo.png"),
              "A: " + (a.file ? a.file.fsName : "(none)") + " / B: " + (b.file ? b.file.fsName : "(none)"));
    });

    // ----------------------------------------------------------------- report

    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (eEnd) { }
    if (previousProject && previousProject.exists) {
        try { app.open(previousProject); } catch (eReopen) { results.push("Could not reopen " + previousProject.fsName); }
    } else {
        try { app.newProject(); } catch (eNew) { }
    }

    var summary = counts.FAIL === 0
        ? "ALL " + counts.PASS + " CHECKS PASSED"
        : counts.FAIL + " FAILED, " + counts.PASS + " passed";
    results.splice(3, 0, "Result: " + summary);
    var text = results.join("\n");

    var reportFile = new File(work.fsName + "/smoke-report.txt");
    try {
        reportFile.encoding = "UTF-8";
        reportFile.open("w");
        reportFile.write(text);
        reportFile.close();
    } catch (eReport) { }

    var win = new Window("dialog", "BigHappy smoke test — " + summary);
    win.alignChildren = "fill";
    var box = win.add("edittext", undefined, text, { multiline: true, readonly: true, scrolling: true });
    box.preferredSize = [640, 420];
    win.add("statictext", undefined, "Saved to: " + reportFile.fsName);
    win.add("button", undefined, "Close", { name: "ok" });
    win.show();
})();
