"use strict";

const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function getPref(branch, prefName) {
    switch (branch.getPrefType(prefName)) {
        case 0:   return undefined;
        case 32:  return branch.getStringPref(prefName);
        case 64:  return branch.getIntPref(prefName);
        case 128: return branch.getBoolPref(prefName);
    }
}

function setDefaultPref(prefName, prefValue) {
    var defaultBranch = Services.prefs.getDefaultBranch(null);
    switch (typeof prefValue) {
        case "string":  defaultBranch.setStringPref(prefName, prefValue); break;
        case "number":  defaultBranch.setIntPref(prefName, prefValue);    break;
        case "boolean": defaultBranch.setBoolPref(prefName, prefValue);   break;
    }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function italicize(str) {
    if (str.slice(-1) === ',') {
        return '<i>' + str.slice(0, -1) + '</i>' + str.slice(-1);
    }
    return '<i>' + str + '</i>';
}

// ---------------------------------------------------------------------------
// Inject signals popup into citation dialog
// ---------------------------------------------------------------------------

function injectUI(doc) {
    if (doc.getElementById('bluebook-signals-popup')) return;

    var branch  = Services.prefs.getBranch('extensions.bluebook-signals.');
    var signals;
    try { signals = JSON.parse(getPref(branch, 'signals')); } catch (e) { return; }
    if (!Array.isArray(signals)) return;

    // Use a native XUL menupopup — renders above all CSS stacking contexts,
    // cannot be clipped by parent XUL panels, and participates in the XUL
    // popup chain so clicking a menuitem doesn't collapse the itemDetails panel.
    var popup = doc.createElementNS(XUL_NS, 'menupopup');
    popup.id = 'bluebook-signals-popup';

    // Style: italic labels to preview how signals will appear in citation
    var style = doc.createElement('style');
    style.textContent = [
        '#bluebook-signals-popup,',
        '#bluebook-signals-popup menuitem {',
        '  font-style: italic;',
        '  font-size: 13px;',
        '}'
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);

    function insertSignal(value) {
        var prefixField = doc.getElementById('prefix');
        if (!prefixField) return;
        var selStart = prefixField.selectionStart;
        var selEnd   = prefixField.selectionEnd;
        var val      = prefixField.value;
        var before   = val.slice(0, selStart);
        var after    = val.slice(selEnd);
        var gap      = before.length ? ' ' : '';
        prefixField.value = (before + gap + value + ' ' + after).replace(/\s+/g, ' ');
        var newPos = (before + gap + value + ' ').length;
        prefixField.setSelectionRange(newPos, newPos);
        // Dispatch native input event so React/Zotero registers the change
        prefixField.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
        prefixField.focus();
    }

    function addItem(label, insertValue) {
        var item = doc.createElementNS(XUL_NS, 'menuitem');
        item.setAttribute('label', label);
        item.addEventListener('command', function () {
            insertSignal(insertValue);
        });
        popup.appendChild(item);
    }

    // Capitalized first, then lowercase
    signals.forEach(function (signal) {
        var cap = signal.slice(0, 1).toUpperCase() + signal.slice(1);
        addItem(cap, italicize(cap));
    });
    signals.forEach(function (signal) {
        addItem(signal, italicize(signal));
    });

    // Attach to div#popups so it's in the right XUL popup context
    var popupsEl = doc.getElementById('popups') || doc.body;
    popupsEl.appendChild(popup);

    // Ctrl+S on the prefix field opens the menu anchored to that field
    doc.addEventListener('keydown', function (event) {
        if (event.key === 's' && event.ctrlKey) {
            var target = event.target;
            if (target && target.id === 'prefix') {
                event.preventDefault();
                event.stopPropagation();
                popup.openPopup(target, 'after_start', 0, 0, false, false);
            }
        }
    }, true);
}

// ---------------------------------------------------------------------------
// Window watcher
// ---------------------------------------------------------------------------

var windowWatcher = {
    observe: function (subject, topic) {
        if (topic !== 'domwindowopened') return;
        var win = subject;
        win.addEventListener('DOMContentLoaded', function onLoad(event) {
            win.removeEventListener('DOMContentLoaded', onLoad);
            var doc  = event.target;
            var root = doc.documentElement;
            if (!root) return;
            if (root.id === 'citation-dialog') {
                injectUI(doc);
            }
        });
    }
};

// ---------------------------------------------------------------------------
// Bootstrap entry points
// ---------------------------------------------------------------------------

function startup({ id, version, rootURI }, reason) {
    Services.scriptloader.loadSubScript(
        rootURI + 'chrome/chrome/content/defaultprefs.js',
        { pref: setDefaultPref }
    );
    Services.ww.registerNotification(windowWatcher);
}

function shutdown(data, reason) {
    Services.ww.unregisterNotification(windowWatcher);
}

function install(data, reason) {}
function uninstall(data, reason) {}
