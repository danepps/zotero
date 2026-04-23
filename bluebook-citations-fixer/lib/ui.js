"use strict";

// Lightweight status UI for field-hook debugging. Zotero 7+ exposes
// MenuManager; older builds fall back to direct Tools-menu insertion.

BCF.ui = {};

BCF.ui.MENU_ID = "bluebook-citations-fixer-status-menuitem";
BCF.ui.MENU_L10N_ID = "bluebook-citations-fixer-status-menuitem";
BCF.ui.MENU_LABEL = "Bluebook Citations Fixer: Status";
BCF.ui._buffer = [];
BCF.ui._bufferMax = 200;
BCF.ui._menuManagerIDs = [];
BCF.ui._windowWatcher = null;

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

BCF.ui.alert = function (title, message) {
    try {
        Services.prompt.alert(null, title || "Bluebook Citations Fixer", String(message));
    } catch (e) {
        try {
            Components.utils.reportError(
                "bluebook-citations-fixer: alert failed: " + e + "\nmsg: " + message
            );
        } catch (_) {}
    }
};

BCF.ui.statusText = function () {
    var lines = [];
    var feats = (BCF.features && BCF.features.list) || [];
    var sess = null;
    try { sess = Zotero.Integration && Zotero.Integration.currentSession; } catch (_) {}

    lines.push("Bluebook Citations Fixer");
    lines.push("Version: " + (BCF.version || "(unknown)"));
    lines.push("Startup error: " + (BCF.startupError || "none"));
    lines.push("Patch installed: " + (BCF.patch && BCF.patch._orig ? "YES" : "NO"));
    lines.push("Features: " + (feats.length
        ? feats.map(function (f) { return f.id; }).join(", ")
        : "(none)"));
    lines.push("Current integration session: " + (sess ? "present" : "none"));
    lines.push("Diagnostics file: " + (BCF.diag && BCF.diag.enabled
        ? BCF.diag.PATH
        : "disabled"));
    lines.push("");
    lines.push("Recent events (" + BCF.ui._buffer.length + "):");
    if (!BCF.ui._buffer.length) {
        lines.push("  (none)");
    } else {
        for (var i = 0; i < BCF.ui._buffer.length; i++) {
            var e = BCF.ui._buffer[i];
            var ts = new Date(e.t).toISOString().substring(11, 19);
            lines.push("  [" + ts + "] " + e.kind +
                (e.data ? ": " + e.data.substring(0, 500) : ""));
        }
    }
    return lines.join("\n");
};

BCF.ui.showStatus = function () {
    BCF.ui.alert("Bluebook Citations Fixer - Status", BCF.ui.statusText());
};

BCF.ui.install = function () {
    if (BCF.ui._installMenuManager()) return;
    BCF.ui._installManualMenu();
};

BCF.ui.uninstall = function () {
    BCF.ui._uninstallMenuManager();
    BCF.ui._uninstallManualMenu();
};

BCF.ui._installMenuManager = function () {
    try {
        if (!Zotero.MenuManager || typeof Zotero.MenuManager.registerMenu !== "function") {
            return false;
        }
        var menuID = Zotero.MenuManager.registerMenu({
            menuID: BCF.ui.MENU_ID,
            pluginID: BCF.id,
            target: "main/menubar/tools",
            menus: [
                {
                    menuType: "menuitem",
                    label: BCF.ui.MENU_LABEL,
                    l10nID: BCF.ui.MENU_L10N_ID,
                    onCommand: function () { BCF.ui.showStatus(); }
                }
            ]
        });
        if (menuID) BCF.ui._menuManagerIDs.push(menuID);
        BCF.ui.record("ui", "MenuManager status item installed");
        return true;
    } catch (e) {
        BCF.ui.record("ui", "MenuManager unavailable: " + e);
        return false;
    }
};

BCF.ui._uninstallMenuManager = function () {
    try {
        if (!Zotero.MenuManager || typeof Zotero.MenuManager.unregisterMenu !== "function") {
            BCF.ui._menuManagerIDs = [];
            return;
        }
        for (var i = 0; i < BCF.ui._menuManagerIDs.length; i++) {
            try { Zotero.MenuManager.unregisterMenu(BCF.ui._menuManagerIDs[i]); } catch (_) {}
        }
    } catch (_) {}
    BCF.ui._menuManagerIDs = [];
};

BCF.ui._installManualMenu = function () {
    try {
        var wins = Services.wm.getEnumerator("navigator:browser");
        while (wins.hasMoreElements()) BCF.ui._addManualMenuItem(wins.getNext());
        BCF.ui._windowWatcher = {
            observe: function (subject, topic) {
                if (topic !== "domwindowopened") return;
                subject.addEventListener("load", function onLoad() {
                    subject.removeEventListener("load", onLoad);
                    var root = subject.document && subject.document.documentElement;
                    if (root && root.getAttribute("windowtype") === "navigator:browser") {
                        BCF.ui._addManualMenuItem(subject);
                    }
                });
            }
        };
        Services.ww.registerNotification(BCF.ui._windowWatcher);
        BCF.ui.record("ui", "manual status item installed");
    } catch (e) {
        BCF.ui.record("ui", "manual menu install failed: " + e);
    }
};

BCF.ui._uninstallManualMenu = function () {
    try {
        if (BCF.ui._windowWatcher) {
            Services.ww.unregisterNotification(BCF.ui._windowWatcher);
            BCF.ui._windowWatcher = null;
        }
    } catch (_) {}
    try {
        var wins = Services.wm.getEnumerator("navigator:browser");
        while (wins.hasMoreElements()) BCF.ui._removeManualMenuItem(wins.getNext());
    } catch (_) {}
};

BCF.ui._addManualMenuItem = function (win) {
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
        item.setAttribute("label", BCF.ui.MENU_LABEL);
        item.addEventListener("command", function () { BCF.ui.showStatus(); });
        toolsMenu.appendChild(item);
    } catch (e) {
        try { Components.utils.reportError(
            "bluebook-citations-fixer: add status menu failed: " + e
        ); } catch (_) {}
    }
};

BCF.ui._removeManualMenuItem = function (win) {
    try {
        var item = win.document.getElementById(BCF.ui.MENU_ID);
        if (item) item.parentNode.removeChild(item);
    } catch (_) {}
};
