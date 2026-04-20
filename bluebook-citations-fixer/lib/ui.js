"use strict";

// UI: alert popups + a ring-buffer of recent events, surfaced via a
// Tools menu item so the user can see what the plugin is doing (or not doing).
// The prior AppleScript plugin used win.alert() for errors; we do the same.

BCF.ui = {};

BCF.ui._buffer = [];
BCF.ui._bufferMax = 200;

BCF.ui.alert = function (title, message) {
    try {
        Services.prompt.alert(
            null,
            title || "Bluebook Citations Fixer",
            String(message)
        );
    } catch (e) {
        try {
            Components.utils.reportError(
                "bluebook-citations-fixer: alert failed: " + e + "\nmsg: " + message
            );
        } catch (_) {}
    }
};

BCF.ui.record = function (kind, data) {
    var entry = {
        t: Date.now(),
        kind: kind,
        data: (data == null) ? "" : (typeof data === "string" ? data : (function () {
            try { return JSON.stringify(data); } catch (_) { return String(data); }
        })())
    };
    BCF.ui._buffer.push(entry);
    if (BCF.ui._buffer.length > BCF.ui._bufferMax) BCF.ui._buffer.shift();
};

BCF.ui.statusText = function () {
    var lines = [];
    lines.push("Bluebook Citations Fixer");
    lines.push("Patch installed: " + (BCF.patch && BCF.patch._orig ? "YES" : "NO"));
    var feats = (BCF.features && BCF.features.list) || [];
    lines.push("Features: " + (feats.length
        ? feats.map(function (f) { return f.id; }).join(", ")
        : "(none)"));
    var sess = null;
    try { sess = Zotero.Integration && Zotero.Integration.currentSession; } catch (_) {}
    lines.push("Current integration session: " + (sess ? "present" : "none"));
    lines.push("");
    lines.push("Recent events (" + BCF.ui._buffer.length + "):");
    if (!BCF.ui._buffer.length) {
        lines.push("  (none — setText has not been observed)");
    } else {
        for (var i = 0; i < BCF.ui._buffer.length; i++) {
            var e = BCF.ui._buffer[i];
            var ts = new Date(e.t).toISOString().substring(11, 19);
            lines.push("  [" + ts + "] " + e.kind +
                (e.data ? ": " + e.data.substring(0, 400) : ""));
        }
    }
    return lines.join("\n");
};

BCF.ui.showStatus = function () {
    BCF.ui.alert("Bluebook Citations Fixer — Status", BCF.ui.statusText());
};

// Menu item management: add "Bluebook Citations Fixer: Status" under Tools
// on every main window.

BCF.ui.MENU_ID = "bluebook-citations-fixer-status-menuitem";

BCF.ui.addMenuItem = function (win) {
    try {
        var doc = win.document;
        if (doc.getElementById(BCF.ui.MENU_ID)) return;
        var toolsMenu = doc.getElementById("menu_ToolsPopup");
        if (!toolsMenu) return;
        var item = doc.createElementNS(
            "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
            "menuitem"
        );
        item.id = BCF.ui.MENU_ID;
        item.setAttribute("label", "Bluebook Citations Fixer: Status");
        item.addEventListener("command", function () { BCF.ui.showStatus(); });
        toolsMenu.appendChild(item);
    } catch (e) {
        try { Components.utils.reportError(
            "bluebook-citations-fixer: addMenuItem failed: " + e
        ); } catch (_) {}
    }
};

BCF.ui.removeMenuItem = function (win) {
    try {
        var item = win.document.getElementById(BCF.ui.MENU_ID);
        if (item) item.parentNode.removeChild(item);
    } catch (_) {}
};

BCF.ui._windowWatcher = {
    observe: function (subject, topic) {
        if (topic !== "domwindowopened") return;
        subject.addEventListener("load", function onLoad() {
            subject.removeEventListener("load", onLoad);
            var root = subject.document && subject.document.documentElement;
            if (root && root.getAttribute("windowtype") === "navigator:browser") {
                BCF.ui.addMenuItem(subject);
            }
        });
    }
};

BCF.ui.installMenu = function () {
    try {
        var wins = Services.wm.getEnumerator("navigator:browser");
        while (wins.hasMoreElements()) BCF.ui.addMenuItem(wins.getNext());
        Services.ww.registerNotification(BCF.ui._windowWatcher);
    } catch (e) {
        try { Components.utils.reportError(
            "bluebook-citations-fixer: installMenu failed: " + e
        ); } catch (_) {}
    }
};

BCF.ui.uninstallMenu = function () {
    try { Services.ww.unregisterNotification(BCF.ui._windowWatcher); } catch (_) {}
    try {
        var wins = Services.wm.getEnumerator("navigator:browser");
        while (wins.hasMoreElements()) BCF.ui.removeMenuItem(wins.getNext());
    } catch (_) {}
};
