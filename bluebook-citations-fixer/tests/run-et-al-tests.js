"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
let CSL = require("citeproc");
// Optional verification against the exact processor bundled in a Zotero build.
if (process.env.BCF_CITEPROC_SOURCE) {
    const processorContext = { console };
    vm.createContext(processorContext);
    vm.runInContext(fs.readFileSync(process.env.BCF_CITEPROC_SOURCE, "utf8"), processorContext);
    CSL = processorContext.CSL;
}
const root = path.resolve(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures");
const MAIN = "https://danepps.github.io/bluebook/BluebookDSEStyle.csl";
const EXP = "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl";
const NS = "http://purl.org/net/xbiblio/csl";
const codec = {
    parse: xml => new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(xml, "application/xml"),
    serialize: doc => new XMLSerializer().serializeToString(doc)
};
const sample = (id = MAIN, extra = "") => `<style xmlns="${NS}" version="1.0"><info><id>${id}</id><title>${id}</title></info>` +
    `<citation et-al-min="5" et-al-use-first="1" ${extra}><layout><names variable="author"><name/></names></layout></citation>` +
    `<bibliography et-al-min="5" et-al-use-first="1"><layout><text variable="title"/></layout></bibliography></style>`;
const minimumOf = xml => Number(codec.parse(xml).getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-min"));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture() {
    const f = { pref: 0, subsequent: 0, resets: 0, events: [], observers: new Set(), constructorCalls: 0 };
    f.Style = function (id) { this.styleID = id; this.title = id; this.xml = sample(id); this.cache = new Map(); };
    f.Style.prototype.getXML = function () { return this.xml; };
    f.Style.prototype.clearEngineCache = function () { this.cache.clear(); };
    f.Style.prototype.getCiteProc = function (locale, format, options) {
        f.constructorCalls++;
        if (f.constructorAction) f.constructorAction(this);
        if (options && options.cache && this.cache.has("engine")) return this.cache.get("engine");
        const engine = { xml: this.getXML(), locale, format, options };
        if (options && options.cache) this.cache.set("engine", engine);
        return engine;
    };
    f.styles = { [MAIN]: new f.Style(MAIN), [EXP]: new f.Style(EXP), other: new f.Style("other") };
    f.sessions = { document: { engine: null } };
    f.Integration = {
        currentDoc: false, currentCommandPromise: Promise.resolve(), sessions: f.sessions,
        Field: function () {}, Session: function () {},
        async execCommand(...args) { return f.command ? f.command(...args) : "command-result"; }
    };
    f.Integration.Field.prototype.setText = t => t;
    for (const name of ["updateDocument", "_updateDocument", "writeDelayedCitation"]) f.Integration.Session.prototype[name] = async () => {};
    f.dependencies = {
        ...codec, ready: async () => {}, stylePrototype: () => f.Style.prototype,
        integration: () => f.Integration, getStyle: id => f.styles[id], pref: name => name.endsWith("subsequentMin") ? f.subsequent : f.pref,
        observe: fn => { f.observers.add(fn); return fn; }, unobserve: fn => f.observers.delete(fn),
        commandActive: () => f.Integration.currentDoc, commandPromise: () => f.Integration.currentCommandPromise,
        delay: tick, timer: () => ({ cancel() {} }),
        reset: async () => {
            f.resets++;
            f.events.push("reset");
            if (f.resetAction) await f.resetAction();
            for (const session of Object.values(f.sessions)) session.engine = f.styles[MAIN].getCiteProc("en-US", "rtf");
        }
    };
    f.Integration.resetSessionStyles = f.dependencies.reset;
    f.dependencies.reset = () => f.Integration.resetSessionStyles();
    f.change = value => { f.pref = value; for (const observer of f.observers) observer(); };
    return f;
}

function instance(f) {
    const context = { BCF: { diag: { event() {}, err(_tag, e) { f.events.push("error:" + e.message); } },
        run: { clearSession() {} } }, Zotero: { Integration: f.Integration, getMainWindow: () => ({ DOMParser }) }, Components: { classes: {}, interfaces: {} } };
    vm.createContext(context);
    for (const name of ["patch.js", "et-al-override.js"]) vm.runInContext(fs.readFileSync(path.join(root, "lib", name), "utf8"), context);
    context.BCF.patch.install();
    return { api: context.BCF.etAl, patch: context.BCF.patch, context,
        start: () => context.BCF.etAl.install(f.dependencies) };
}

function styleSyncFixture(f, owner) {
    vm.runInContext(fs.readFileSync(path.join(root, "lib/style-sync.js"), "utf8"), owner.context);
    const sync = owner.context.BCF.styleSync;
    const dated = date => sample().replace("</info>", `<updated>${date}</updated></info>`);
    f.styles[MAIN].xml = dated("2026-09-01T00:00:00Z");
    const remote = dated("2026-09-12T00:00:00Z");
    const d = {
        parse: codec.parse, getInstalledStyles: () => f.styles, installTargets: () => [],
        getStyle: async id => f.styles[id] || null,
        fetch: async () => remote,
        validate: async () => {},
        // Intentionally use the production withStyleChange adapter, which
        // resolves the actual et-al module in this shared VM.
        install: async (id, xml) => {
            f.events.push("install:start");
            if (f.installAction) await f.installAction();
            f.styles[id] = new f.Style(id); f.styles[id].xml = xml;
            f.Integration.resetSessionStyles(); // Native reinit starts this WITHOUT await
            f.events.push("install:end");
        }
    };
    return { sync, deps: d, remote, run: () => sync.checkStyle(MAIN, d) };
}

async function sharedStyleGateTests() {
    // An existing document command finishes first. New commands are blocked
    // through installer awaits AND verification; preference resets queue behind
    // the install and propagate to all open documents before commands resume.
    const f = fixture(); f.sessions.second = { engine: null }; f.sessions.third = { engine: null };
    const owner = instance(f); await owner.start();
    const bridge = styleSyncFixture(f, owner), active = deferred(), install = deferred(), entered = deferred();
    f.command = async name => { f.events.push("command:" + name); if (name === "active") await active.promise; return name; };
    const activeCommand = f.Integration.execCommand("active"); await tick();
    f.installAction = () => { entered.resolve(); return install.promise; };
    const verified = deferred(), verifyEntered = deferred();
    bridge.deps.getStyle = async id => {
        if (f.events.includes("install:end")) { verifyEntered.resolve(); await verified.promise; }
        return f.styles[id];
    };
    const update = bridge.run(); await tick();
    assert(!f.events.includes("install:start"));
    active.resolve(); await activeCommand; await entered.promise;
    const late = f.Integration.execCommand("late");
    const before = f.resets;
    f.subsequent = 4; f.change(9); await tick();
    assert.strictEqual(f.resets, before, "preference reset overlapped installer");
    assert(!f.events.includes("command:late"));
    install.resolve(); await verifyEntered.promise;
    assert(!f.events.includes("command:late"), "command entered during verification");
    verified.resolve(); assert.strictEqual((await update).status, "updated");
    assert.strictEqual(await late, "late");
    for (const session of Object.values(f.sessions)) assert.strictEqual(minimumOf(session.engine.xml), 9);
    assert(f.events.indexOf("command:late") > f.events.lastIndexOf("reset"));
    assert.strictEqual(f.styles[MAIN].getXML(), bridge.remote);
    await owner.api.uninstall(); owner.patch.uninstall();

    // Installer rejection releases the gate and still lets queued resets and
    // original document commands complete normally.
    const failed = fixture(), failedOwner = instance(failed); await failedOwner.start();
    const bad = styleSyncFixture(failed, failedOwner), badGate = deferred(), badEntered = deferred();
    failed.installAction = async () => { badEntered.resolve(); await badGate.promise; throw new Error("install failed"); };
    const badRun = bad.run(); await badEntered.promise;
    let ran = false; failed.command = async () => { ran = true; return "ok"; };
    const afterFailure = failed.Integration.execCommand(); failed.change(4); await tick(); assert(!ran);
    badGate.resolve(); assert.strictEqual((await badRun).status, "failed");
    assert.strictEqual(await afterFailure, "ok"); assert(ran);
    assert.strictEqual(minimumOf(failed.sessions.document.engine.xml), 4);
    await failedOwner.api.uninstall(); failedOwner.patch.uninstall();

    // Hot disable/upgrade during installation preserves exclusion until the
    // old install settles, then rebuilds using the latest instance and prefs.
    const upgraded = fixture(), old = instance(upgraded); await old.start();
    const oldSync = styleSyncFixture(upgraded, old), upgradeGate = deferred(), upgradeEntered = deferred();
    upgraded.installAction = () => { upgradeEntered.resolve(); return upgradeGate.promise; };
    const oldRun = oldSync.run(); await upgradeEntered.promise;
    oldSync.sync.cancel();
    const teardown = old.api.uninstall();
    upgraded.pref = 11;
    const replacement = instance(upgraded), ready = replacement.start();
    let resumed = false; upgraded.command = async () => { resumed = true; };
    const newCommand = upgraded.Integration.execCommand(); await tick(); assert(!resumed);
    upgradeGate.resolve(); assert.strictEqual((await oldRun).status, "cancelled");
    await teardown; old.patch.uninstall(); old.context.BCF = null;
    await ready; await newCommand;
    assert(resumed); assert.strictEqual(minimumOf(upgraded.sessions.document.engine.xml), 11);
    await replacement.api.uninstall(); replacement.patch.uninstall();

    // App shutdown also retains a gate for an installation already in flight.
    const quitting = fixture(), quitOwner = instance(quitting); await quitOwner.start();
    const quitSync = styleSyncFixture(quitting, quitOwner), quitGate = deferred(), quitEntered = deferred();
    quitting.installAction = () => { quitEntered.resolve(); return quitGate.promise; };
    const quitRun = quitSync.run(); await quitEntered.promise;
    quitSync.sync.cancel(); const quit = quitOwner.api.uninstall(true);
    let quitDone = false; quit.then(() => { quitDone = true; }); await tick(); assert(!quitDone);
    quitGate.resolve(); await quitRun; await quit; quitOwner.patch.uninstall();

    // Final local-state checks take place AFTER the command wait: do not
    // recreate a removed style or downgrade an independently newer one.
    for (const mode of ["removed", "newer", "cancelled"]) {
        const local = fixture(), localOwner = instance(local); await localOwner.start();
        const localSync = styleSyncFixture(local, localOwner), hold = deferred();
        local.command = async () => hold.promise;
        const command = local.Integration.execCommand(); await tick();
        const pending = localSync.run(); await tick();
        if (mode === "removed") delete local.styles[MAIN];
        if (mode === "newer") local.styles[MAIN].xml = localSync.remote.replace("2026-09-12", "2026-09-13");
        if (mode === "cancelled") localSync.sync.cancel();
        hold.resolve(); await command;
        assert.strictEqual((await pending).status, { removed: "not-installed", newer: "up-to-date", cancelled: "cancelled" }[mode]);
        assert(!local.events.includes("install:start"));
        if (!local.styles[MAIN]) local.styles[MAIN] = new local.Style(MAIN);
        await localOwner.api.uninstall(); localOwner.patch.uninstall();
    }
    // Missing command gate fails closed rather than using a racy fallback.
    const unavailable = fixture(), unavailableOwner = instance(unavailable);
    const blocked = styleSyncFixture(unavailable, unavailableOwner);
    assert.strictEqual((await blocked.run()).status, "failed");
    assert(!unavailable.events.includes("install:start")); unavailableOwner.patch.uninstall();
}

async function detachedResetTests() {
    for (const mode of ["normal", "failure", "disable", "shutdown", "upgrade", "preferences", "install-failure"]) {
        const f = fixture(), owner = instance(f); await owner.start();
        f.sessions.second = { engine: f.styles[MAIN].getCiteProc() };
        f.sessions.third = { engine: f.styles[MAIN].getCiteProc() };
        const bridge = styleSyncFixture(f, owner), wait = deferred(), entered = deferred();
        f.resetAction = async () => {
            entered.resolve(); await wait.promise;
            if (mode === "failure") throw new Error("native rebuild failed");
        };
        if (mode === "install-failure") {
            bridge.deps.install = async () => {
                f.Integration.resetSessionStyles();
                throw new Error("installer failed after starting reset");
            };
        }
        let finished = false, commandEntered = false, cleanup, replacement, ready;
        const update = bridge.run().then(result => { finished = true; return result; });
        await entered.promise;
        if (["disable", "shutdown", "upgrade"].includes(mode)) {
            bridge.sync.cancel(); cleanup = owner.api.uninstall(mode === "shutdown");
        }
        if (mode === "upgrade") { replacement = instance(f); ready = replacement.start(); }
        if (mode === "preferences") f.change(9);
        f.command = async () => { commandEntered = true; return "command-result"; };
        const command = f.Integration.execCommand(); await tick();
        assert.strictEqual(finished, false, mode + ": install resolved before detached rebuild");
        assert.strictEqual(commandEntered, false, mode + ": command entered during detached rebuild");
        let cleaned = false; if (cleanup) cleanup.then(() => { cleaned = true; });
        await tick(); if (cleanup) assert.strictEqual(cleaned, false, mode);
        wait.resolve();
        const result = await update;
        assert.strictEqual(result.status, ["failure", "install-failure"].includes(mode) ? "failed"
            : ["disable", "shutdown", "upgrade"].includes(mode) ? "cancelled" : "updated", mode);
        await cleanup; await ready;
        assert.strictEqual(await command, "command-result");
        if (mode === "preferences") {
            for (const session of Object.values(f.sessions)) assert.strictEqual(minimumOf(session.engine.xml), 9);
        }
        f.resetAction = null;
        if (replacement) { await replacement.api.uninstall(); replacement.patch.uninstall(); }
        if (!cleanup) await owner.api.uninstall();
        owner.patch.uninstall();
    }

    // A reset may reject before the installer settles. Retain the failure in
    // the task's scope, and wait for every other reset before releasing it.
    const f = fixture(), owner = instance(f); await owner.start();
    const delayed = deferred(); let calls = 0;
    f.resetAction = async () => { if (++calls === 1) throw new Error("early rejection"); await delayed.promise; };
    let settled = false;
    const task = owner.api.withStyleChange(async () => {
        f.Integration.resetSessionStyles(); f.Integration.resetSessionStyles(); await tick();
    }).then(() => { throw new Error("reset failure was swallowed"); }, error => {
        settled = true; assert.strictEqual(error.message, "early rejection");
    });
    await tick(); assert.strictEqual(settled, false);
    delayed.resolve(); await task;
    f.resetAction = null;
    const previous = f.Integration.resetSessionStyles;
    const foreign = function (...args) { return previous.apply(this, args); };
    f.Integration.resetSessionStyles = foreign;
    await owner.api.uninstall(); owner.patch.uninstall();
    assert.strictEqual(f.Integration.resetSessionStyles, foreign);
    const before = f.resets;
    await f.Integration.resetSessionStyles();
    assert.strictEqual(f.resets, before + 1);
}

async function main() {
    const f = fixture(), first = instance(f), api = first.api;
    for (const value of [undefined, null, -1, 1, 2, 12, 1000, 3.5, "3", NaN]) assert.strictEqual(api.option(value), 0);
    for (const value of [3, 4, 5, 6, 7, 8, 9, 10, 11]) assert.strictEqual(api.option(value), value);
    const raw = sample();
    assert.strictEqual(api.rewriteXML(raw, 0, MAIN, codec), raw);
    for (const n of [3, 4, 5]) {
        const changed = api.rewriteXML(raw, n, MAIN, codec);
        assert.strictEqual(minimumOf(changed), n);
        assert.strictEqual(api.rewriteXML(changed, n, MAIN, codec), changed);
    }
    const independent = codec.parse(api.rewriteXML(raw, 9, MAIN, codec));
    assert.strictEqual(independent.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-min"), "5");
    const subsequentOnly = codec.parse(api.rewriteXML(raw, 0, MAIN, codec, 4));
    assert.strictEqual(subsequentOnly.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-min"), "5");
    assert.strictEqual(subsequentOnly.getElementsByTagNameNS(NS, "bibliography")[0].getAttribute("et-al-min"), "5");
    assert.strictEqual(subsequentOnly.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-min"), "4");
    for (const option of ['et-al-use-last="true"', 'disambiguate-add-names="true"']) {
        assert.throws(() => api.rewriteXML(sample(MAIN, option), 3, MAIN, codec));
    }
    assert.throws(() => api.rewriteXML(raw, 3, EXP, codec));
    assert.throws(() => api.rewriteXML("<invalid/>", 3, MAIN, codec));
    const noBib = raw.replace(/<bibliography[\s\S]*<\/bibliography>/, "").replace('et-al-min="5"', "");
    const noBibDoc = codec.parse(api.rewriteXML(noBib, 3, MAIN, codec));
    assert.strictEqual(noBibDoc.getElementsByTagNameNS(NS, "bibliography").length, 0);
    assert.strictEqual(noBibDoc.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-min"), "3");
    const placements = raw.replace('<style xmlns=', '<style et-al-min="9" xmlns=')
        .replace('<names variable=', '<names et-al-use-first="2" variable=')
        .replace('<name/>', '<name et-al-min="7" et-al-use-first="2"/>');
    const placementDoc = codec.parse(api.rewriteXML(placements, 4, MAIN, codec));
    for (const node of Array.from(placementDoc.getElementsByTagNameNS(NS, "*"))) {
        if (node.hasAttribute("et-al-min")) {
            assert.strictEqual(node.getAttribute("et-al-min"), "4");
            assert.strictEqual(node.getAttribute("et-al-use-first"), "1");
        }
    }

    await first.start();
    assert.strictEqual(f.observers.size, 2);
    const style = f.styles[MAIN];
    const inheritedXML = style.getXML;
    const cachedDefault = style.getCiteProc("en-US", "html", { cache: true });
    f.change(3);
    await api.whenSettled();
    for (const format of ["rtf", "html", "text"]) {
        const engine = style.getCiteProc("en-US", format, { cache: true });
        assert.strictEqual(minimumOf(engine.xml), 3);
        assert.notStrictEqual(engine, cachedDefault);
    }
    f.subsequent = 9; f.change(3); await api.whenSettled();
    let splitXML = style.getCiteProc("en-US", "html", { cache: true }).xml;
    assert.strictEqual(minimumOf(splitXML), 3);
    assert.strictEqual(codec.parse(splitXML).getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-min"), "9");
    f.subsequent = 0; f.change(3); await api.whenSettled();
    assert.strictEqual(style.getXML, inheritedXML);
    assert(!Object.hasOwn(style, "getXML"));
    assert.strictEqual(style.xml, raw, "installed CSL changed");
    assert.strictEqual(minimumOf(f.styles.other.getCiteProc().xml), 5);
    assert.strictEqual(minimumOf(f.styles[EXP].getCiteProc().xml), 3);
    const unidentified = new f.Style(MAIN);
    delete unidentified.styleID;
    assert.strictEqual(minimumOf(unidentified.getCiteProc().xml), 5);
    Object.defineProperty(unidentified, "styleID", { get() { throw new Error("unreadable identity"); } });
    assert.strictEqual(minimumOf(unidentified.getCiteProc().xml), 5);
    f.change(0); await api.whenSettled();
    assert.strictEqual(minimumOf(style.getCiteProc("en-US", "text", { cache: true }).xml), 5);
    f.change(4); f.change(5); f.change(3);
    const beforeReset = f.resets;
    await api.whenSettled();
    assert.strictEqual(f.resets - beforeReset, 1, "rapid changes did not coalesce");
    assert.strictEqual(minimumOf(f.sessions.document.engine.xml), 3);
    assert.strictEqual(f.Integration.sessions, f.sessions);

    // Preserve an own-property descriptor and restore after constructor errors
    // or nested construction. Only transformer failures delegate unchanged.
    Object.defineProperty(style, "getXML", { value: inheritedXML, configurable: true, enumerable: false, writable: false });
    const descriptor = Object.getOwnPropertyDescriptor(style, "getXML");
    const error = new Error("original engine failure");
    f.constructorAction = () => { throw error; };
    const calls = f.constructorCalls;
    assert.throws(() => style.getCiteProc(), e => e === error);
    assert.strictEqual(f.constructorCalls, calls + 1);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(style, "getXML"), descriptor);
    let nesting = false;
    f.constructorAction = current => {
        if (!nesting) { nesting = true; assert.strictEqual(minimumOf(current.getCiteProc().xml), 3); }
    };
    assert.strictEqual(minimumOf(style.getCiteProc().xml), 3);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(style, "getXML"), descriptor);
    f.constructorAction = null;
    style.xml = sample(MAIN, 'et-al-use-last="true"');
    assert.strictEqual(minimumOf(style.getCiteProc().xml), 5);
    style.xml = raw;

    // A native command already active before hook entry postpones the reset.
    const native = deferred();
    f.Integration.currentDoc = true;
    f.Integration.currentCommandPromise = native.promise;
    const beforeNative = f.resets;
    f.change(4);
    await tick();
    assert.strictEqual(f.resets, beforeNative);
    f.Integration.currentDoc = false; native.resolve();
    await api.whenSettled();
    assert.strictEqual(minimumOf(f.sessions.document.engine.xml), 4);

    // A command through the hook holds the reset back; a later command waits
    // for that reset. Original results and argument lists are preserved.
    const active = deferred();
    f.command = async (...args) => { f.events.push("command:" + args[0]); await active.promise; return args; };
    const command = f.Integration.execCommand("first", 9);
    await tick();
    f.change(3);
    const next = f.Integration.execCommand("next", 10);
    await tick();
    assert(!f.events.includes("command:next"));
    active.resolve();
    assert.deepStrictEqual(await command, ["first", 9]);
    assert.deepStrictEqual(await next, ["next", 10]);
    assert(f.events.lastIndexOf("reset") < f.events.indexOf("command:next"));

    // Disable keeps the barrier until engines revert; no session is deleted.
    const resetWait = deferred();
    f.resetAction = () => resetWait.promise;
    const stopped = api.uninstall();
    await tick();
    const afterDisable = f.Integration.execCommand("disabled");
    await tick();
    assert(!f.events.includes("command:disabled"));
    resetWait.resolve();
    await stopped; await afterDisable;
    assert.strictEqual(f.observers.size, 0);
    assert.strictEqual(minimumOf(f.sessions.document.engine.xml), 5);
    first.patch.uninstall();
    first.context.BCF = null;

    // The latest generation owns the engine hook even under a foreign wrapper.
    const g = fixture(); g.pref = 3;
    const a = instance(g); await a.start();
    const old = g.Style.prototype.getCiteProc;
    let foreignCalls = 0;
    const foreign = function (...args) { foreignCalls++; return old.apply(this, args); };
    g.Style.prototype.getCiteProc = foreign;
    const b = instance(g); await b.start();
    await a.api.uninstall(); a.patch.uninstall(); a.context.BCF = null;
    assert.strictEqual(minimumOf(g.styles[MAIN].getCiteProc().xml), 3);
    assert(foreignCalls > 0);
    await b.api.uninstall(); b.patch.uninstall(); b.context.BCF = null;
    assert.strictEqual(g.Style.prototype.getCiteProc, foreign);
    assert.strictEqual(minimumOf(g.styles[MAIN].getCiteProc().xml), 5);

    // Disable before styles are ready cancels setup, including the observer.
    const h = fixture(), ready = deferred();
    h.dependencies.ready = () => ready.promise;
    const cancelled = instance(h);
    const setup = cancelled.start();
    await cancelled.api.uninstall();
    cancelled.patch.uninstall();
    cancelled.context.BCF = null;
    ready.resolve(); await setup;
    assert.strictEqual(h.observers.size, 0);
    assert.strictEqual(h.resets, 0);

    // The latest setting wins if changed while an earlier reset is running.
    const j = fixture(); j.pref = 3;
    const reentrant = instance(j); await reentrant.start();
    let changedDuringReset = false;
    j.resetAction = () => { if (!changedDuringReset) { changedDuringReset = true; j.change(5); } };
    j.change(4); await reentrant.api.whenSettled();
    assert.strictEqual(minimumOf(j.sessions.document.engine.xml), 5);
    await reentrant.api.uninstall(); reentrant.patch.uninstall();

    // A style-sync replacement constructs fresh Style objects; rebuilt session
    // engines must retain the preference without writing an overridden CSL.
    const k = fixture(); k.pref = 3;
    const synced = instance(k); await synced.start();
    k.styles[MAIN] = new k.Style(MAIN);
    const replacementXML = k.styles[MAIN].xml;
    await k.dependencies.reset();
    assert.strictEqual(minimumOf(k.sessions.document.engine.xml), 3);
    assert.strictEqual(k.styles[MAIN].getXML(), replacementXML);
    await synced.api.uninstall(); synced.patch.uninstall();

    await sharedStyleGateTests();
    await detachedResetTests();

    // Real CSL + real citeproc-js: threshold boundaries in all output formats,
    // both built-ins, citations and bibliographies, with original XML retained.
    const locale = fs.readFileSync(path.join(fixtures, "locales-en-US.xml"), "utf8");
    let renders = 0;
    for (const [file, id] of [["BluebookDSEStyle.csl", MAIN], ["BluebookDSEStyle-Experimental.csl", EXP]]) {
        const xml = fs.readFileSync(path.join(fixtures, file), "utf8");
        const beforeDoc = codec.parse(xml), afterDoc = codec.parse(api.rewriteXML(xml, 3, id, codec));
        for (const doc of [beforeDoc, afterDoc]) {
            for (const node of Array.from(doc.getElementsByTagNameNS(NS, "*"))) {
                for (const name of ["et-al-min", "et-al-use-first", "et-al-subsequent-min", "et-al-subsequent-use-first"]) node.removeAttribute(name);
            }
        }
        assert.strictEqual(codec.serialize(afterDoc), codec.serialize(beforeDoc), "unrelated CSL content changed");
        for (const [n, subsequent] of [[0, 0], [9, 0], [0, 3], [9, 4], [3, 3], [11, 4]])
        for (const type of ["book", "article-journal"])
        for (const count of [2, 3, 4, 5, 8, 9, 10, 11]) for (const format of ["text", "html", "rtf"]) {
            const rewritten = api.rewriteXML(xml, n, id, codec, subsequent);
            const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda"].slice(0, count);
            const item = { id: "1", type, title: "Fixture Work", "container-title": "Fixture Review", volume: "10", page: "100", author: names.map(family => ({ family, given: "A" })),
                issued: { "date-parts": [[2020]] }, publisher: "Fixture Press" };
            const intervening = { id: "2", type: "book", title: "Intervening Book", author: [{family: "Other"}],
                issued: { "date-parts": [[2021]] } };
            const engine = new CSL.Engine({ retrieveLocale: () => locale, retrieveItem: id => id === "1" ? item : intervening }, rewritten, "en-US");
            engine.setOutputFormat(format);
            function cite(id, note, previous) {
                const result = engine.processCitationCluster({citationID: "c" + note, citationItems: [{id}], properties: {noteIndex: note}}, previous, []);
                return result[1].find(row => row[0] === note - 1)[1];
            }
            const citation = cite("1", 1, []);
            cite("2", 2, [["c1", 1]]);
            const repeat = cite("1", 3, [["c1", 1], ["c2", 2]]);
            const bibliography = engine.makeBibliography()[1].find(output => output.includes("Alpha"));
            for (const [kind, output, threshold] of [["first", citation, n || 5], ["subsequent", repeat, subsequent || 4], ["bibliography", bibliography, n || 5]]) {
                assert(output.includes("Alpha"));
                const truncated = count >= threshold;
                assert.strictEqual(output.includes(names[count - 1]), !truncated, `${file} ${type} first=${n} subsequent=${subsequent} authors=${count} ${format} ${kind} threshold=${threshold}: ${output}`);
                assert.strictEqual(/et al\./.test(output.replace(/<[^>]*>/g, "")), truncated);
                renders++;
            }
        }
    }
    console.log(`bluebook-citations-fixer et-al tests passed (${renders} citation/bibliography renders)`);
}

const watchdog = setTimeout(() => { console.error("Et-al integration tests timed out (pending promise)"); process.exit(1); }, 30000);
main().then(() => clearTimeout(watchdog), error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
