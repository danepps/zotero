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

BCF.diag.event = function (kind, data) {
    try { if (BCF.ui) BCF.ui.record(kind, data); } catch (_) {}
    BCF.diag.log("[" + kind + "]", data == null ? "" : data);
};

// Recurring errors (e.g. Zotero 10 changed Field._code so every setText hit
// throws "this._code.indexOf is not a function") would otherwise spam the
// Error Console. Track a per-(tag + message) seen-set and downgrade
// duplicates to file-only logging.
BCF.diag._errSeen = Object.create(null);

BCF.diag.err = function (tag, e) {
    var msg = String(e);
    var s = "[ERR " + tag + "] " + msg;
    if (e && e.stack) s += "\n" + e.stack;
    var key = tag + "::" + msg;
    var firstTime = !BCF.diag._errSeen[key];
    if (firstTime) {
        BCF.diag._errSeen[key] = true;
        try { Components.utils.reportError("bluebook-citations-fixer: " + s); } catch (_) {}
    }
    if (BCF.diag.enabled) BCF.diag._append(s + "\n");
    try { if (BCF.ui) BCF.ui.record("error", tag + ": " + msg); } catch (_) {}
};
