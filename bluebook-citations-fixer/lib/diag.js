"use strict";

// Optional diagnostic log for debugging. Off by default; enable by setting
// the pref `extensions.bluebook-citations-fixer.diag = true` in about:config.
// When enabled, appends lines to /tmp/bluebook-citations-fixer-diag.txt.

BCF.diag = {};

BCF.diag.PATH = "/tmp/bluebook-citations-fixer-diag.txt";
BCF.diag.enabled = false;

BCF.diag.init = function () {
    try {
        var v = Zotero.Prefs.get("extensions.bluebook-citations-fixer.diag", true);
        BCF.diag.enabled = !!v;
    } catch (_) {
        BCF.diag.enabled = false;
    }
    if (BCF.diag.enabled) {
        BCF.diag._truncate();
        BCF.diag.log("---- session start " + new Date().toISOString() + " ----");
    }
};

BCF.diag._truncate = function () {
    try {
        var f = Components.classes["@mozilla.org/file/local;1"]
            .createInstance(Components.interfaces.nsIFile);
        f.initWithPath(BCF.diag.PATH);
        if (f.exists()) f.remove(false);
    } catch (_) {}
};

BCF.diag._append = function (text) {
    try {
        var Cc = Components.classes;
        var Ci = Components.interfaces;
        var f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        f.initWithPath(BCF.diag.PATH);
        // PR_WRONLY | PR_CREATE_FILE | PR_APPEND
        var os = Cc["@mozilla.org/network/file-output-stream;1"]
            .createInstance(Ci.nsIFileOutputStream);
        os.init(f, 0x02 | 0x08 | 0x10, 0o644, 0);
        var cos = Cc["@mozilla.org/intl/converter-output-stream;1"]
            .createInstance(Ci.nsIConverterOutputStream);
        cos.init(os, "UTF-8", 0, 0);
        cos.writeString(text);
        cos.close();
    } catch (_) {}
};

BCF.diag.log = function () {
    if (!BCF.diag.enabled) return;
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (typeof a === "string") parts.push(a);
        else {
            try { parts.push(JSON.stringify(a)); }
            catch (_) { parts.push(String(a)); }
        }
    }
    BCF.diag._append(parts.join(" ") + "\n");
};

BCF.diag.err = function (tag, e) {
    var s = "[ERR " + tag + "] " + String(e);
    if (e && e.stack) s += "\n" + e.stack;
    try { Components.utils.reportError("bluebook-citations-fixer: " + s); } catch (_) {}
    if (BCF.diag.enabled) BCF.diag._append(s + "\n");
    try { if (BCF.ui) BCF.ui.record("error", tag + ": " + String(e)); } catch (_) {}
    try { if (BCF.ui) BCF.ui.alert(
        "Bluebook Citations Fixer — Error",
        s
    ); } catch (_) {}
};
