"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { DOMParser } = require("@xmldom/xmldom");
const root = path.resolve(__dirname, "..");
const MAIN = "https://danepps.github.io/bluebook/BluebookDSEStyle.csl";
const EXP = "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl";
const PREFIX = "extensions.bluebook-citations-fixer.";
const ATTEMPT = PREFIX + "styleSetup.lastAttempt";
const STATUS = PREFIX + "styleSetup.status", ENABLED = PREFIX + "styleSync";
const NOW = Date.parse("2026-09-12T23:00:00Z");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
    const f = { styles: {}, prefs: { [ATTEMPT]: "0", [ENABLED]: false }, calls: [], timers: [], notices: [] };
    const xml = fs.readFileSync(path.join(root, "tests/fixtures/BluebookDSEStyle.csl"), "utf8");
    f.xml = xml;
    const context = { BCF: { patch: { PRIMARY_STYLE_ID: MAIN, BUILTIN_STYLE_IDS: [MAIN, EXP] }, diag: { event() {}, err() {} } },
        Zotero: { getMainWindow: () => ({ DOMParser }), Prefs: { get: name => f.prefs[name], set: (name, value) => { f.prefs[name] = value; } },
            ProgressWindow: function () {
                this.changeHeadline = value => f.notices.push(value);
                this.addDescription = value => f.notices.push(value);
                this.show = () => f.notices.push("shown");
                this.startCloseTimer = ms => f.notices.push(ms);
            }
        }, Components: { classes: { "@mozilla.org/timer;1": { createInstance: () => ({
            initWithCallback(callback, delay) { f.timers.push({ callback, delay }); }, cancel() { f.cancelledTimer = true; }
        }) } }, interfaces: { nsITimer: { TYPE_ONE_SHOT: 0 } } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, "lib/style-sync.js"), "utf8"), context);
    f.context = context; f.sync = context.BCF.styleSync;
    f.deps = {
        getInstalledStyles: () => f.styles, installTargets: () => [], withStyleChange: async (task, current) => {
            while (f.deps.commandActive()) {
                await f.deps.commandPromise();
                if (!current()) return undefined;
                if (f.deps.commandActive()) await tick();
            }
            return task();
        }, now: () => NOW, getStyle: async id => f.styles[id] || null,
        fetch: async id => { f.calls.push(["fetch", id]); return f.xml; },
        validate: async text => { f.calls.push(["validate", text]); },
        install: async (id, text) => { f.calls.push(["install", id, text]); f.styles[id] = { getXML: () => text }; },
        commandActive: () => false, commandPromise: () => Promise.resolve(), delay: tick };
    f.run = () => f.sync.check(f.deps, true);
    return f;
}
async function bootstrapFailureTests() {
    for (const failure of ["load", "throw", "reject", "missing-style-api"]) {
        const f = fixture(), context = f.context;
        context.Zotero.initializationPromise = Promise.resolve();
        context.Zotero.Styles = { init: async () => {}, get: id => f.styles[id] };
        context.Zotero.Integration = { Field: function () {}, Session: function () {},
            execCommand: async () => "ok", resetSessionStyles: async () => {} };
        context.Zotero.Integration.Field.prototype.setText = text => text;
        for (const name of ["updateDocument", "_updateDocument", "writeDelayedCitation"]) {
            context.Zotero.Integration.Session.prototype[name] = async () => {};
        }
        const errors = [];
        context.Services = { scriptloader: { loadSubScript(name, scope) {
            if (name === "lib/diag.js") scope.BCF.diag = { init() {}, event() {}, err(_tag, e) { errors.push(e.message); } };
            else if (name === "lib/dialog.js") scope.BCF.dialog = { install() {}, uninstall() {} };
            else if (name === "lib/et-al-override.js" && failure !== "missing-style-api") {
                if (failure === "load") throw new Error("et-al load failed");
                scope.BCF.etAl = { install() {
                    if (failure === "throw") throw new Error("et-al setup failed");
                    return Promise.reject(new Error("et-al setup rejected"));
                }, uninstall: async () => {} };
            } else if (["lib/patch.js", "lib/style-change-gate.js", "lib/style-sync.js", "lib/et-al-override.js"].includes(name)) {
                vm.runInNewContext(fs.readFileSync(path.join(root, name), "utf8"), scope);
                if (name === "lib/style-sync.js") {
                    const sync = scope.BCF.styleSync, defaults = sync._defaultDeps;
                    const injected = { ...f.deps }; delete injected.withStyleChange;
                    sync._defaultDeps = () => Object.assign(defaults(), injected);
                }
            }
        } } };
        vm.runInContext(fs.readFileSync(path.join(root, "bootstrap.js"), "utf8"), context);
        await context.startup({ rootURI: "" });
        await tick();
        assert(f.timers.some(t => t.delay === 5000), failure + ": repair was not scheduled");
        f.timers.find(t => t.delay === 5000).callback.notify();
        await tick(); await tick();
        assert(f.calls.some(c => c[0] === "install"), failure + ": repair did not install");
        assert(context.Zotero.Integration.__bcfStyleGate, failure + ": independent gate absent");
        assert(errors.length, failure + ": optional startup failure was not reported");
        await context.shutdown({}, 2);
    }
}
async function main() {
    await bootstrapFailureTests();
    // Metadata must come from direct CSL info children, never comments or
    // lookalikes. Exercise the production parser with real XML.
    const metadata = fixture();
    const otherID = "https://example.invalid/custom.csl";
    const wrong = metadata.xml.replace("<id>" + MAIN + "</id>", "<id>" + otherID + "</id>")
        .replace("<info>", "<!-- <id>" + MAIN + "</id> --><info>");
    assert.strictEqual(metadata.sync.parseStyleID(wrong), otherID);
    metadata.xml = wrong;
    assert.strictEqual((await metadata.run()).counts.failed, 1);
    assert(!metadata.calls.some(c => c[0] === "install"));
    const fresh = fixture(), stamp = fresh.sync.parseUpdated(fresh.xml);
    assert.strictEqual(fresh.sync.parseUpdated(fresh.xml.replace("<info>",
        "<!-- <updated>2099-01-01T00:00:00Z</updated> --><info>")), stamp);
    for (const xml of [fresh.xml.replace("<info>", '<info xmlns="urn:not-csl">'),
        fresh.xml.replace("<id>", "<id>duplicate</id><id>"),
        fresh.xml.replace("<id>" + MAIN + "</id>", "<summary><id>" + MAIN + "</id></summary>"),
        fresh.xml.replace("<info>", "<info></info><info>")]) {
        assert.strictEqual(fresh.sync.parseStyleID(xml), null);
    }
    const prefixed = '<c:style xmlns:c="http://purl.org/net/xbiblio/csl"><c:info>' +
        '<c:id>' + MAIN + '</c:id><c:title>Title</c:title><c:updated>2026-10-31T00:00:00Z</c:updated></c:info></c:style>';
    assert.strictEqual(fresh.sync.parseStyleID(prefixed), MAIN);
    assert.strictEqual(fresh.sync.parseUpdated(prefixed), Date.parse("2026-10-31T00:00:00Z"));
    assert.strictEqual(fresh.sync.parseStyleID(prefixed.replace('<c:id>', '<c:id><c:text>')
        .replace('</c:id>', '</c:text></c:id>')), null);
    assert.strictEqual(fresh.sync.parseUpdated(prefixed.replace('00:00:00Z', '00:00:00')), null);

    // Silent install must not replace another identity by title or filename,
    // including hidden/unindexed files. Repeat through the Settings bridge.
    for (const mode of ["title", "visible", "hidden", "unindexed", "inventory-error"])
    for (const manual of [false, true]) {
        const safe = fixture(), title = safe.sync.parseMetadata(safe.xml).title;
        const occupied = new Set();
        const target = path => ({ path, exists: () => occupied.has(path) });
        const targets = [target("/styles/BluebookDSEStyle.csl"), target("/styles/hidden/BluebookDSEStyle.csl")];
        safe.deps.installTargets = () => targets;
        safe.deps.styleUsesFile = (style, file) => style.path === file.path;
        if (mode === "title") safe.styles[otherID] = { styleID: otherID, title };
        if (mode === "visible" || mode === "hidden") {
            const file = targets[mode === "visible" ? 0 : 1]; occupied.add(file.path);
            safe.styles[otherID] = { styleID: otherID, title: "Custom style", path: file.path };
        }
        if (mode === "unindexed") occupied.add(targets[0].path);
        if (mode === "inventory-error") safe.deps.getInstalledStyles = () => { throw new Error("inventory unavailable"); };
        if (manual) await assert.rejects(safe.sync.installStyle(MAIN, safe.deps));
        else {
            const result = await safe.run();
            assert.strictEqual(result.counts.failed, 1, mode);
            assert.strictEqual(result.results[0].stage, "collision", mode);
            assert(safe.sync.summaryLabel(result).includes("style conflict"));
        }
        assert(!safe.calls.some(c => c[0] === "install"), mode);
        if (mode === "title" || mode === "visible" || mode === "hidden") assert(safe.styles[otherID]);
    }
    const lateConflict = fixture();
    lateConflict.deps.withStyleChange = async task => {
        lateConflict.styles[otherID] = { styleID: otherID, title: lateConflict.sync.parseMetadata(lateConflict.xml).title };
        return task();
    };
    assert.strictEqual((await lateConflict.run()).results[0].stage, "collision");
    assert(!lateConflict.calls.some(c => c[0] === "install"));
    // Exercise the runtime inventory/path adapters too, including a hidden
    // file on a case-insensitive filesystem (nsIFile.equals handles identity).
    const adapters = fixture(), disk = new Set(["/styles/hidden/bluebookdsestyle.csl"]);
    function diskFile(path) {
        return { path, clone() { return diskFile(this.path); }, append(name) { this.path += "/" + name; },
            exists() { return disk.has(this.path.toLowerCase()); },
            equals(other) { return this.path.toLowerCase() === other.path.toLowerCase(); } };
    }
    adapters.context.Zotero.getStylesDirectory = () => diskFile("/styles");
    adapters.context.Zotero.File = { getValidFileName: name => name, pathToFile: diskFile };
    adapters.context.Zotero.Styles = { getAll: () => adapters.styles };
    delete adapters.deps.getInstalledStyles; delete adapters.deps.installTargets;
    adapters.styles[otherID] = { styleID: otherID, title: "Different title", path: "/styles/hidden/bluebookdsestyle.csl" };
    assert.strictEqual((await adapters.run()).results[0].stage, "collision");
    assert(!adapters.calls.some(c => c[0] === "install"));
    delete adapters.styles[otherID]; disk.clear();
    assert.strictEqual((await adapters.run()).counts.installed, 1);
    // A verified same-ID file is a valid update target.
    const owned = fixture(), file = { path: "/styles/main.csl", exists: () => true };
    owned.styles[MAIN] = { styleID: MAIN, title: owned.sync.parseMetadata(owned.xml).title,
        path: file.path, getXML: () => owned.xml.replace(/<updated>[^<]+<\/updated>/, '<updated>2000-01-01T00:00:00Z</updated>') };
    owned.deps.installTargets = () => [file]; owned.deps.styleUsesFile = (style, target) => style.path === target.path;
    owned.styles[otherID] = { styleID: otherID, title: owned.styles[MAIN].title, path: "/styles/custom.csl" };
    assert.strictEqual((await owned.sync.check(owned.deps)).counts.updated, 1);
    const manualInstall = fixture();
    assert.strictEqual(await manualInstall.sync.installStyle(MAIN, manualInstall.deps), true);
    assert.deepStrictEqual(manualInstall.calls.map(c => c[0]), ["fetch", "validate", "install"]);
    assert.strictEqual(manualInstall.calls[1][1], manualInstall.calls[2][2]);
    const invalidManual = fixture(); invalidManual.xml = wrong;
    await assert.rejects(invalidManual.sync.installStyle(MAIN, invalidManual.deps), /identity/);
    assert(!invalidManual.calls.some(c => c[0] === "install"));

    // Both missing: only main is fetched, validated, installed and verified;
    // document preferences are not involved. Removing main causes the next setup check to reinstall it.
    const f = fixture();
    const p = f.run(); assert.strictEqual(p, f.run());
    const res = await p;
    assert.strictEqual(res.counts.installed, 1);
    assert.strictEqual(f.sync.summaryLabel(res), "Epps Bluebook style installed");
    assert.deepStrictEqual(f.calls.map(call => call[0]), ["fetch", "validate", "install"]);
    assert(f.calls.filter(call => call[0] === "fetch").every(call => call[1] === MAIN));
    assert.strictEqual(f.calls[1][1], f.calls[2][2]);
    assert.strictEqual(f.prefs[ATTEMPT], String(NOW));
    assert.strictEqual(f.prefs[STATUS], "Epps Bluebook style installed");
    assert.deepStrictEqual(f.notices, ["Bluebook Citations Fixer", "Epps Bluebook style installed", "shown", 5000]);
    assert(!f.styles[EXP]);
    delete f.styles[MAIN]; f.calls.length = 0;
    await f.run(); assert.strictEqual(f.calls.filter(c => c[0] === "install").length, 1);
    delete f.styles[MAIN]; f.calls.length = 0;
    await f.sync.check(f.deps); assert.strictEqual(f.calls.length, 0); // ordinary updates remain installed-only

    // Existing main closes setup without network, even with no readable revision.
    const existing = fixture(); existing.styles[MAIN] = {};
    const present = await existing.run();
    assert.strictEqual(present.counts.alreadyInstalled, 1);
    assert.strictEqual(existing.calls.length, 0); assert.strictEqual(existing.notices.length, 0);
    // Having experimental alone does not replace main or refresh experimental.
    const experimental = fixture(); experimental.styles[EXP] = {};
    await experimental.run(); assert.deepStrictEqual(experimental.styles[EXP], {});
    assert.strictEqual(experimental.calls.filter(c => c[0] === "install").length, 1);

    for (const failure of ["fetch", "id", "timestamp", "validate", "install", "unverified"]) {
        const bad = fixture();
        if (failure === "id") bad.xml = bad.xml.replace(MAIN, EXP);
        else if (failure === "timestamp") bad.xml = bad.xml.replace(/<updated>[^<]+<\/updated>/, "<updated>bad</updated>");
        else if (failure === "unverified") bad.deps.install = async () => {};
        else bad.deps[failure] = async () => { throw new Error(failure); };
        const failed = await bad.run();
        assert.strictEqual(failed.counts.installed, 0, failure);
        assert(bad.notices.includes("Epps Bluebook style unavailable"), failure);
        const description = bad.notices.find(n => typeof n === "string" && n.includes("Install style"));
        assert(description, failure);
        assert(description.includes(failure === "fetch" ? "could not be downloaded"
            : failure === "unverified" ? "could not be verified" : "could not be installed"), failure);
        if (!["install", "unverified"].includes(failure)) assert(!bad.calls.some(c => c[0] === "install"));
    }
    // Warning throttle uses the previous persisted startup attempt, while
    // every startup still retries and writes its current status/timestamp.
    const throttled = fixture(); let retries = 0, now = NOW;
    throttled.deps.now = () => now;
    throttled.deps.fetch = async () => { retries++; throw new Error("offline"); };
    await throttled.run();
    const notices = throttled.notices.length;
    now += 60 * 60 * 1000;
    await throttled.run();
    assert.strictEqual(retries, 2);
    assert.strictEqual(throttled.notices.length, notices);
    assert.strictEqual(throttled.prefs[ATTEMPT], String(now));
    assert.strictEqual(throttled.prefs[STATUS], "1 check failed");
    now += throttled.sync.CHECK_INTERVAL_MS;
    await throttled.run();
    assert.strictEqual(retries, 3);
    assert.strictEqual(throttled.notices.length, notices * 2);
    // Clock rollback cannot suppress warnings forever.
    now -= 1; await throttled.run();
    assert.strictEqual(throttled.notices.length, notices * 3);

    // Cancellation at every await boundary prevents completion/notification.
    for (const stage of ["getStyle", "fetch", "validate", "install"]) {
        const cancelled = fixture(), gate = deferred(), entered = deferred();
        const original = cancelled.deps[stage];
        cancelled.deps[stage] = async (...args) => { entered.resolve(); await gate.promise; return original(...args); };
        const pending = cancelled.run(); await entered.promise;
        cancelled.sync.cancel(); gate.resolve();
        const result = await pending;
        assert.strictEqual(result.counts.cancelled, 1, stage);
        assert.strictEqual(cancelled.prefs[ATTEMPT], "0");
        assert.strictEqual(cancelled.notices.length, 0);
        if (stage !== "install") assert(!cancelled.calls.some(c => c[0] === "install"));
    }
    // Active command wait plus a second active command must both finish.
    const command = fixture(), first = deferred(), second = deferred();
    let active = 2, waits = 0;
    command.deps.commandActive = () => active > 0;
    command.deps.commandPromise = () => (++waits === 1 ? first.promise : second.promise);
    const waiting = command.run(); await tick();
    assert(!command.calls.some(c => c[0] === "install"));
    active = 1; first.resolve(); await tick(); await tick();
    assert(!command.calls.some(c => c[0] === "install"));
    active = 0; second.resolve(); await waiting;
    assert(command.styles[MAIN]);
    // A manual installation racing the fetch is preserved.
    const race = fixture();
    race.deps.validate = async () => { race.styles[MAIN] = { getXML: () => "manual copy" }; };
    await race.run(); assert(!race.calls.some(c => c[0] === "install"));
    assert.strictEqual(race.styles[MAIN].getXML(), "manual copy");

    // Startup runs setup at 5s even when update checks are disabled, then
    // avoids rescheduling after completion; routine update delay stays 60s.
    const startup = fixture();
    const originalCheck = startup.sync.check;
    startup.sync.check = (_deps, setupOnly) => originalCheck.call(startup.sync, startup.deps, setupOnly);
    startup.sync.scheduleStartupCheck();
    assert.strictEqual(startup.timers[0].delay, 5000);
    startup.timers[0].callback.notify(); await tick(); await tick();
    assert(startup.styles[MAIN]);
    assert.strictEqual(startup.timers.length, 1);
    // A fresh startup restores a style removed after the preceding startup.
    delete startup.styles[MAIN]; startup.sync._setupCheckedThisStartup = false;
    startup.sync.scheduleStartupCheck(); startup.timers[1].callback.notify(); await tick(); await tick();
    assert(startup.styles[MAIN]);
    startup.prefs[ENABLED] = true;
    startup.sync.scheduleStartupCheck(); assert.strictEqual(startup.timers[2].delay, 60000);
    startup.sync.cancel(); assert(startup.cancelledTimer);

    // Exercise real check/clear ordering: a routine run already in flight
    // cannot swallow the startup timer's setup request.
    const concurrent = fixture(), gate = deferred();
    const getStyle = concurrent.deps.getStyle;
    concurrent.deps.getStyle = async id => { await gate.promise; return getStyle(id); };
    const concurrentCheck = concurrent.sync.check;
    concurrent.sync.check = (_deps, setupOnly) => concurrentCheck.call(concurrent.sync, concurrent.deps, setupOnly);
    const routineFirst = concurrent.sync.check(concurrent.deps);
    concurrent.sync.scheduleStartupCheck(); concurrent.timers[0].callback.notify(); await tick();
    assert.strictEqual(concurrent.calls.length, 0);
    gate.resolve(); await routineFirst; await tick(); await tick();
    assert(concurrent.styles[MAIN]);
    assert.strictEqual(concurrent.prefs[PREFIX + "styleSync.lastCheck"], String(NOW));

    // Conversely, manual routine checks during setup queue one REAL update
    // run afterward, returning its results and stamping lastCheck.
    const manual = fixture(), fetchGate = deferred(), fetchEntered = deferred();
    const fetch = manual.deps.fetch;
    manual.deps.fetch = async id => { fetchEntered.resolve(); await fetchGate.promise; return fetch(id); };
    const setupFirst = manual.run(); await fetchEntered.promise;
    const routineAfter = manual.sync.check(manual.deps);
    assert.notStrictEqual(routineAfter, setupFirst);
    assert.strictEqual(manual.sync.check(manual.deps), routineAfter);
    assert.strictEqual(manual.prefs[PREFIX + "styleSync.lastCheck"], undefined);
    fetchGate.resolve();
    const setupResult = await setupFirst, routineResult = await routineAfter;
    assert.strictEqual(setupResult.counts.installed, 1);
    assert.strictEqual(routineResult.counts.installed, 0);
    assert.strictEqual(routineResult.counts.upToDate, 1);
    assert.strictEqual(manual.prefs[PREFIX + "styleSync.lastCheck"], String(NOW));
    assert.deepStrictEqual(manual.calls.map(call => call[0]), ["fetch", "validate", "install", "fetch"]);
    assert.strictEqual(manual.sync._queuedRoutine, null);

    // A queued routine request must not restart work after shutdown.
    const stopped = fixture(), stopGate = deferred(), stopEntered = deferred();
    stopped.deps.fetch = async () => { stopEntered.resolve(); await stopGate.promise; return stopped.xml; };
    const stoppedSetup = stopped.run(); await stopEntered.promise;
    const stoppedRoutine = stopped.sync.check(stopped.deps);
    stopped.sync.cancel(); stopped.context.BCF = null; stopGate.resolve();
    await stoppedSetup;
    assert.strictEqual((await stoppedRoutine).counts.cancelled, 1);
    assert.strictEqual(stopped.prefs[PREFIX + "styleSync.lastCheck"], undefined);
    assert.strictEqual(stopped.notices.length, 0);

    const missingID = fixture(); delete missingID.context.BCF.patch.PRIMARY_STYLE_ID;
    await missingID.run(); assert.strictEqual(missingID.calls.length, 0);
    console.log("bluebook-citations-fixer style setup tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
