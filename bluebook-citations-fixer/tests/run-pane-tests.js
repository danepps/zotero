"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const MAIN = "https://danepps.github.io/bluebook/BluebookDSEStyle.csl";
const EXP = "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl";
const NOTES = "https://danepps.github.io/bluebook/#changelog";

class Element {
    constructor() { this.attributes = {}; this.listeners = {}; this.children = []; }
    getAttribute(name) { return this.attributes[name]; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
}

async function main() {
    const elements = {};
    for (const id of ["bcf-prefpane", "bcf-style-all", "bcf-style-list", "bcf-style-manual",
        "bcf-style-setup-status", "bcf-style-sync-check", "bcf-style-sync-status", "bcf-style-versions", "bcf-et-al-min", "bcf-et-al-subsequent-min"]) elements[id] = new Element();
    // The existing style picker is already built; exercise the update section.
    elements["bcf-style-list"].setAttribute("data-bcf-built", "1");
    const link = new Element();
    link.style = {};
    link.setAttribute("href", NOTES);
    elements["bcf-prefpane"].querySelectorAll = () => [link];
    const windowListeners = {};
    let observer, setupObserver, unregistered = [], launched, checks = 0, pendingRead, etAl = 4, subsequent = 0;
    let versions = [{ id: MAIN, status: "installed", updated: Date.parse("2026-09-12T14:14:28Z") },
        { id: EXP, status: "not-installed", updated: null }];
    const context = {
        document: { getElementById: id => elements[id], createXULElement: () => new Element(),
            addEventListener() {}, removeEventListener() {} },
        window: { addEventListener: (name, fn) => { windowListeners[name] = fn; }, setTimeout },
        Zotero: {
            Prefs: {
                get(name) { return name.endsWith("etAl.min") ? etAl : name.endsWith("etAl.subsequentMin") ? subsequent : undefined; },
                set(name, value, global) {
                    assert(["extensions.bluebook-citations-fixer.etAl.min", "extensions.bluebook-citations-fixer.etAl.subsequentMin"].includes(name));
                    assert.strictEqual(global, true);
                    assert.strictEqual(typeof value, "number");
                    if (name.endsWith("subsequentMin")) subsequent = value; else etAl = value;
                },
                registerObserver(name, fn, global) {
                assert(["extensions.bluebook-citations-fixer.styleSync.lastCheck", "extensions.bluebook-citations-fixer.styleSetup.lastAttempt"].includes(name));
                assert.strictEqual(global, true);
                if (name.endsWith("lastAttempt")) { setupObserver = fn; return "setup-token"; }
                observer = fn;
                return "observer-token";
            }, unregisterObserver: token => { unregistered.push(token); } },
            BluebookCitationsFixer: {
                installedStyleVersions: () => pendingRead || Promise.resolve(versions),
                checkStyleUpdates: async () => { checks++; return {}; },
                styleUpdateSummary: () => "Updated 1 style",
                styleSetupStatus: () => "Epps Bluebook style installed"
            },
            launchURL: url => { launched = url; }, logError() {}, debug() {}
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "prefs-pane.js"), "utf8"), context);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    await flush();
    const labels = () => elements["bcf-style-versions"].children;
    assert(labels()[0].getAttribute("value").endsWith("2026-09-12"));
    assert.strictEqual(labels()[0].getAttribute("tooltiptext"), "Updated 2026-09-12 14:14:28 UTC");
    assert(labels()[1].getAttribute("value").endsWith("Not installed"));
    await setupObserver();
    assert.strictEqual(elements["bcf-style-setup-status"].value, "Startup check: Epps Bluebook style installed");
    assert.strictEqual(checks, 0, "opening settings must not check the network");
    assert.strictEqual(elements["bcf-et-al-min"].value, "4");
    elements["bcf-et-al-min"].value = "3";
    elements["bcf-et-al-min"].listeners.change();
    assert.strictEqual(etAl, 3);
    elements["bcf-et-al-min"].value = "0";
    elements["bcf-et-al-min"].listeners.change();
    assert.strictEqual(etAl, 0);
    assert.strictEqual(elements["bcf-et-al-subsequent-min"].value, "0");
    elements["bcf-et-al-subsequent-min"].value = "9";
    elements["bcf-et-al-subsequent-min"].listeners.change();
    assert.strictEqual(subsequent, 9);
    assert.strictEqual(etAl, 0);
    elements["bcf-et-al-subsequent-min"].value = "1.5";
    elements["bcf-et-al-subsequent-min"].listeners.change();
    assert.strictEqual(subsequent, 9);
    assert.strictEqual(elements["bcf-et-al-subsequent-min"].value, "9");
    for (const value of [3, 4, 5, 6, 7, 8, 9, 10, 11, 0]) {
        elements["bcf-et-al-subsequent-min"].value = String(value);
        elements["bcf-et-al-subsequent-min"].listeners.change();
        assert.strictEqual(subsequent, value);
        assert.strictEqual(etAl, 0);
    }
    link.listeners.click({ preventDefault() {} });
    assert.strictEqual(launched, NOTES);
    assert(fs.readFileSync(path.join(root, "prefs.xhtml"), "utf8").includes('href="' + NOTES + '"'));

    // A background/manual check refreshes the installed date; late older reads
    // cannot overwrite it. The observer is removed when the window closes.
    let resolveOld;
    pendingRead = new Promise(resolve => { resolveOld = resolve; });
    const oldRefresh = observer();
    pendingRead = null;
    versions = [{ id: MAIN, status: "installed", updated: Date.parse("2026-09-13T01:02:03Z") },
        { id: EXP, status: "installed", updated: null }];
    await observer();
    resolveOld([{ id: MAIN, status: "installed", updated: Date.parse("2026-09-01T00:00:00Z") }]);
    await oldRefresh;
    assert(labels()[0].getAttribute("value").endsWith("2026-09-13"));
    assert(labels()[1].getAttribute("value").endsWith("Revision date unavailable"));
    elements["bcf-style-sync-check"].listeners.command();
    await flush();
    assert.strictEqual(checks, 1);
    assert.strictEqual(elements["bcf-style-sync-status"].value, "Updated 1 style");
    assert.strictEqual(elements["bcf-style-sync-check"].disabled, false);
    windowListeners.unload();
    assert.deepStrictEqual(unregistered, ["observer-token", "setup-token"]);
    console.log("bluebook-citations-fixer pane tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
