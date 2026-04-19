"use strict";

// ---------------------------------------------------------------------------
// Menu helpers
// ---------------------------------------------------------------------------

var menuItem = null;
var _rootURI = null;

function addMenuItem(win) {
    var doc = win.document;
    if (doc.getElementById('bluebook-fixer-menuitem')) return;

    var toolsMenu = doc.getElementById('menu_ToolsPopup');
    if (!toolsMenu) return;

    var item = doc.createElementNS(
        'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul',
        'menuitem'
    );
    item.id = 'bluebook-fixer-menuitem';
    item.setAttribute('label', 'Fix Bluebook Citations');
    item.addEventListener('command', function () {
        fixCitations(win);
    });
    toolsMenu.appendChild(item);
}

function removeMenuItem(win) {
    var item = win.document.getElementById('bluebook-fixer-menuitem');
    if (item) item.parentNode.removeChild(item);
}

// ---------------------------------------------------------------------------
// AppleScript bridge
// ---------------------------------------------------------------------------

function runAppleScriptWithOutput(script) {
    var tmpDir = Components.classes['@mozilla.org/file/directory_service;1']
        .getService(Components.interfaces.nsIProperties)
        .get('TmpD', Components.interfaces.nsIFile);

    var scriptFile = tmpDir.clone();
    scriptFile.append('bluebook-fixer.applescript');
    if (scriptFile.exists()) scriptFile.remove(false);
    scriptFile.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0o600);

    var outFile = tmpDir.clone();
    outFile.append('bluebook-fixer-out.txt');
    if (outFile.exists()) outFile.remove(false);

    var os = Components.classes['@mozilla.org/network/file-output-stream;1']
        .createInstance(Components.interfaces.nsIFileOutputStream);
    os.init(scriptFile, 0x02 | 0x08 | 0x20, 0o600, 0);
    var cos = Components.classes['@mozilla.org/intl/converter-output-stream;1']
        .createInstance(Components.interfaces.nsIConverterOutputStream);
    cos.init(os, 'UTF-8', 0, 0);
    cos.writeString(script);
    cos.close();

    var shell = Components.classes['@mozilla.org/file/local;1']
        .createInstance(Components.interfaces.nsIFile);
    shell.initWithPath('/bin/sh');

    var proc = Components.classes['@mozilla.org/process/util;1']
        .createInstance(Components.interfaces.nsIProcess);
    proc.init(shell);

    var cmd = 'osascript ' + scriptFile.path + ' > ' + outFile.path + ' 2>&1';
    var args = ['-c', cmd];
    proc.run(true, args, args.length);

    var result = '';
    if (outFile.exists()) {
        var is = Components.classes['@mozilla.org/network/file-input-stream;1']
            .createInstance(Components.interfaces.nsIFileInputStream);
        is.init(outFile, 0x01, 0o444, 0);
        var cis = Components.classes['@mozilla.org/intl/converter-input-stream;1']
            .createInstance(Components.interfaces.nsIConverterInputStream);
        cis.init(is, 'UTF-8', 0, 0);
        var str = {};
        var data = '';
        while (cis.readString(4096, str) !== 0) {
            data += str.value;
        }
        cis.close();
        result = data;
        outFile.remove(false);
    }

    scriptFile.remove(false);
    return result;
}

// ---------------------------------------------------------------------------
// Core fix logic
// ---------------------------------------------------------------------------

function loadAppleScript() {
    var req = new XMLHttpRequest();
    req.open('GET', _rootURI + 'extract-citations.applescript', false);
    req.send(null);
    if (req.status !== 0 && req.status !== 200) {
        throw new Error('Failed to load extract-citations.applescript: ' + req.status);
    }
    return req.responseText;
}

function fixCitations(win) {
    var script = loadAppleScript();
    var result = runAppleScriptWithOutput(script);

    if (!result || result.trim() === '') {
        win.alert('No Zotero citation fields found in the active Word document.\n\nMake sure Word is open with a document containing Zotero citations.');
        return;
    }

    var preview = result.length > 1000 ? result.slice(0, 1000) + '\n...(truncated)' : result;
    win.alert('Found citation fields:\n\n' + preview);
}

// ---------------------------------------------------------------------------
// Window watcher
// ---------------------------------------------------------------------------

var windowWatcher = {
    observe: function (subject, topic) {
        if (topic === 'domwindowopened') {
            subject.addEventListener('load', function onLoad() {
                subject.removeEventListener('load', onLoad);
                if (subject.document.documentElement.getAttribute('windowtype') === 'navigator:browser') {
                    addMenuItem(subject);
                }
            });
        }
    }
};

// ---------------------------------------------------------------------------
// Bootstrap entry points
// ---------------------------------------------------------------------------

function startup({ id, version, rootURI }, reason) {
    try {
        _rootURI = rootURI;
        var windows = Services.wm.getEnumerator('navigator:browser');
        while (windows.hasMoreElements()) {
            addMenuItem(windows.getNext());
        }
        Services.ww.registerNotification(windowWatcher);
    } catch (e) {
        Components.utils.reportError('Bluebook Fixer startup error: ' + e);
    }
}

function shutdown(data, reason) {
    try {
        Services.ww.unregisterNotification(windowWatcher);
        var windows = Services.wm.getEnumerator('navigator:browser');
        while (windows.hasMoreElements()) {
            removeMenuItem(windows.getNext());
        }
    } catch (e) {
        Components.utils.reportError('Bluebook Fixer shutdown error: ' + e);
    }
}

function install(data, reason) {}
function uninstall(data, reason) {}
