/*
    BHDialog — in-panel replacements for alert()/confirm().
    Native dialogs in CEP show an ugly "JavaScript Alert - file:///…" chrome
    title; these render a styled modal inside the panel instead.

      BHDialog.alert(message, title?)   -> Promise<void>
      BHDialog.confirm(message, title?) -> Promise<boolean>
*/
(function (global) {
    "use strict";

    var overlay = null;
    var queue = Promise.resolve();   // serialize dialogs — see show()

    function build() {
        overlay = document.createElement("div");
        overlay.className = "bh-modal-overlay";
        // role/aria-modal tell a screen reader this is a dialog and that the
        // rest of the panel behind it is inert; the ids wire the title and
        // message up as the dialog's accessible name and description.
        overlay.innerHTML =
            '<div class="bh-modal" role="dialog" aria-modal="true"' +
                    ' aria-labelledby="bh-modal-title" aria-describedby="bh-modal-msg">' +
                '<div class="bh-modal-title" id="bh-modal-title"></div>' +
                '<div class="bh-modal-msg" id="bh-modal-msg"></div>' +
                '<div class="bh-modal-btns">' +
                    '<button class="btn btn-ghost bh-modal-no">Cancel</button>' +
                    '<button class="btn btn-primary bh-modal-yes">OK</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
    }

    /**
     * Dialogs share ONE overlay, so two concurrent calls (e.g. the boot
     * update check and the What's New popup) must not run at once — the
     * second would steal the overlay and the first promise would never
     * resolve, hanging its caller. Queue them instead.
     */
    function show(message, title, isConfirm) {
        var next = queue.then(function () { return showNow(message, title, isConfirm); });
        queue = next.then(function () { }, function () { });
        return next;
    }

    function showNow(message, title, isConfirm) {
        if (!overlay) build();
        return new Promise(function (resolve) {
            overlay.querySelector(".bh-modal-title").textContent = title || (isConfirm ? "Confirm" : "BigHappy Launcher");
            overlay.querySelector(".bh-modal-msg").textContent = String(message);
            var yes = overlay.querySelector(".bh-modal-yes");
            var no = overlay.querySelector(".bh-modal-no");
            no.classList.toggle("hidden", !isConfirm);
            // Whatever the user was on before the dialog opened — focus goes
            // back there on close, instead of to the top of the document.
            var previousFocus = document.activeElement;
            requestAnimationFrame(function () {
                overlay.classList.add("show");
                yes.focus();
            });

            /** The dialog's focusable controls, in tab order. */
            function stops() {
                return isConfirm ? [no, yes] : [yes];
            }

            /**
             * Keep Tab inside the dialog. Without this, Tab walks straight
             * out into the panel behind the overlay, where every control is
             * still reachable and clickable while the dialog is up.
             */
            function trap(ev) {
                if (ev.key !== "Tab") return;
                var focusable = stops();
                ev.preventDefault();
                var at = focusable.indexOf(document.activeElement);
                var next = ev.shiftKey
                    ? (at <= 0 ? focusable.length - 1 : at - 1)
                    : (at === -1 || at === focusable.length - 1 ? 0 : at + 1);
                focusable[next].focus();
            }

            function finish(result) {
                yes.onclick = no.onclick = null;
                document.removeEventListener("keydown", onKey);
                document.removeEventListener("keydown", trap, true);
                if (previousFocus && typeof previousFocus.focus === "function") {
                    try { previousFocus.focus(); } catch (e) { }
                }
                resolve(result);
            }
            function done(result, animate) {
                if (!animate) overlay.classList.add("is-static");
                overlay.classList.remove("show");
                if (animate) {
                    setTimeout(function () { finish(result); }, 120);
                } else {
                    finish(result);
                    requestAnimationFrame(function () { overlay.classList.remove("is-static"); });
                }
            }
            function onKey(ev) {
                if (ev.key === "Escape") done(isConfirm ? false : undefined, false);
                if (ev.key === "Enter") done(isConfirm ? true : undefined, false);
            }
            yes.onclick = function () { done(isConfirm ? true : undefined, true); };
            no.onclick = function () { done(false, true); };
            document.addEventListener("keydown", onKey);
            document.addEventListener("keydown", trap, true);   // capture: beat other handlers
        });
    }

    global.BHDialog = {
        alert: function (message, title) { return show(message, title, false); },
        confirm: function (message, title) { return show(message, title, true); }
    };
})(window);
