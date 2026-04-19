"use strict";

// Optional diagnostic log for debugging. Off by default; enable by setting
// the pref `extensions.legal-citations-fixer.diag = true` in about:config.
// When enabled, appends lines to /tmp/legal-citations-fixer-diag.txt.

LCF.diag = {};

LCF.diag.PATH = "/tmp/legal-citations-fixer-diag.txt";
LCF.diag.enabled = false;

LCF.diag.init = function () {
    try {
        var v = Zotero.Prefs.get("extensions.legal-citations-fixer.diag", true);
        LCF.diag.enabled = !!v;
    } catch (_) {
        LCF.diag.enabled = false;
    }
    if (LCF.diag.enabled) {
        LCF.diag._truncate();
        LCF.diag.log("---- session start " + new Date().toISOString() + " ----");
    }
};

LCF.diag._truncate = function () {
    try {
        var f = Components.classes["@mozilla.org/file/local;1"]
            .createInstance(Components.interfaces.nsIFile);
        f.initWithPath(LCF.diag.PATH);
        if (f.exists()) f.remove(false);
    } catch (_) {}
};

LCF.diag._append = function (text) {
    try {
        var Cc = Components.classes;
        var Ci = Components.interfaces;
        var f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        f.initWithPath(LCF.diag.PATH);
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

LCF.diag.log = function () {
    if (!LCF.diag.enabled) return;
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (typeof a === "string") parts.push(a);
        else {
            try { parts.push(JSON.stringify(a)); }
            catch (_) { parts.push(String(a)); }
        }
    }
    LCF.diag._append(parts.join(" ") + "\n");
};

LCF.diag.err = function (tag, e) {
    var s = "[ERR " + tag + "] " + String(e);
    if (e && e.stack) s += "\n" + e.stack;
    try { Components.utils.reportError("legal-citations-fixer: " + s); } catch (_) {}
    if (LCF.diag.enabled) LCF.diag._append(s + "\n");
};
