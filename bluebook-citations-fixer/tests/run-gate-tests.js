"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { MAIN, minimumOf, tick, deferred, fixture, instance, styleSyncFixture } = require("./helpers/engine-fixture");

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
    await owner.stop(); owner.patch.uninstall();

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
    await failedOwner.stop(); failedOwner.patch.uninstall();

    // Hot disable/upgrade during installation preserves exclusion until the
    // old install settles, then rebuilds using the latest instance and prefs.
    const upgraded = fixture(), old = instance(upgraded); await old.start();
    const oldSync = styleSyncFixture(upgraded, old), upgradeGate = deferred(), upgradeEntered = deferred();
    upgraded.installAction = () => { upgradeEntered.resolve(); return upgradeGate.promise; };
    const oldRun = oldSync.run(); await upgradeEntered.promise;
    oldSync.sync.cancel();
    const teardown = old.stop();
    upgraded.pref = 11;
    const replacement = instance(upgraded), ready = replacement.start();
    let resumed = false; upgraded.command = async () => { resumed = true; };
    const newCommand = upgraded.Integration.execCommand(); await tick(); assert(!resumed);
    upgradeGate.resolve(); assert.strictEqual((await oldRun).status, "cancelled");
    await teardown; old.patch.uninstall(); old.context.BCF = null;
    await ready; await newCommand;
    assert(resumed); assert.strictEqual(minimumOf(upgraded.sessions.document.engine.xml), 11);
    await replacement.stop(); replacement.patch.uninstall();

    // App shutdown also retains a gate for an installation already in flight.
    const quitting = fixture(), quitOwner = instance(quitting); await quitOwner.start();
    const quitSync = styleSyncFixture(quitting, quitOwner), quitGate = deferred(), quitEntered = deferred();
    quitting.installAction = () => { quitEntered.resolve(); return quitGate.promise; };
    const quitRun = quitSync.run(); await quitEntered.promise;
    quitSync.sync.cancel(); const quit = quitOwner.stop(true);
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
        await localOwner.stop(); localOwner.patch.uninstall();
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
            bridge.sync.cancel(); cleanup = owner.stop(mode === "shutdown");
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
        if (replacement) { await replacement.stop(); replacement.patch.uninstall(); }
        if (!cleanup) await owner.stop();
        owner.patch.uninstall();
    }

    // A reset may reject before the installer settles. Retain the failure in
    // the task's scope, and wait for every other reset before releasing it.
    const f = fixture(), owner = instance(f); await owner.start();
    const delayed = deferred(); let calls = 0;
    f.resetAction = async () => { if (++calls === 1) throw new Error("early rejection"); await delayed.promise; };
    let settled = false;
    const task = owner.gate.withStyleChange(async () => {
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
    await owner.stop(); owner.patch.uninstall();
    assert.strictEqual(f.Integration.resetSessionStyles, foreign);
    const before = f.resets;
    await f.Integration.resetSessionStyles();
    assert.strictEqual(f.resets, before + 1);
}


async function migrationTests() {
    const f = fixture(), old = instance(f);
    // Load the exact prior module so migration exercises its real drain and
    // ownership records rather than a simulation of the legacy coordinator.
    vm.runInContext(fs.readFileSync(path.join(__dirname, "fixtures/legacy-et-al-1.3.3.10.js"), "utf8"), old.context);
    const legacy = old.context.BCF.etAl;
    await legacy.install(f.dependencies);
    const c = f.Style.prototype.__bcfEtAlCoordinator;
    const hold = deferred(), entered = deferred();
    const pending = legacy.withStyleChange(async () => { entered.resolve(); await hold.promise; });
    await entered.promise;
    const current = instance(f), ready = current.start();
    assert.strictEqual(f.Integration.__bcfStyleGate, c);
    assert.strictEqual(f.Style.prototype.__bcfEtAlCoordinator, undefined);
    assert.strictEqual(Object.keys(f.Integration).includes("__bcfStyleGate"), false);
    let ran = false; f.command = async () => { ran = true; };
    const command = f.Integration.execCommand(); await tick(); assert(!ran);
    hold.resolve(); await pending; await ready; await command; assert(ran);
    await legacy.uninstall(); old.patch.uninstall();
    await current.stop(); current.patch.uninstall();

    // No Style prototype is needed. Retry a lazy Integration API, and cancel
    // the retry on disable; an old callback cannot reinstall handlers.
    const lazy = fixture(), owner = instance(lazy); let retry, cancelled = false;
    owner.gate.install({ ...lazy.dependencies, stylePrototype: () => null,
        integration: () => null, timer: fn => { retry = fn; return { cancel() { cancelled = true; } }; } });
    await assert.rejects(owner.gate.withStyleChange(() => {}), /unavailable/);
    await owner.gate.uninstall(); assert(cancelled); retry();
    assert.strictEqual(lazy.Integration.__bcfStyleGate, undefined);
    owner.patch.uninstall();
}
async function shutdownCancelsResetTests() {
    const f = fixture(), owner = instance(f); await owner.start();
    const hold = deferred(), entered = deferred();
    const task = owner.gate.withStyleChange(async () => { entered.resolve(); await hold.promise; });
    await entered.promise;
    const before = f.resets;
    f.change(9);
    const stopped = owner.stop(true);
    await tick(); hold.resolve(); await stopped; await task;
    assert.strictEqual(f.resets, before, "application exit started a queued preference reset");
    owner.patch.uninstall();
}
async function main() {
    await sharedStyleGateTests();
    await detachedResetTests();
    await migrationTests();
    await shutdownCancelsResetTests();
    console.log("bluebook-citations-fixer gate tests passed");
}
const watchdog = setTimeout(() => { console.error("Gate tests timed out"); process.exit(1); }, 30000);
main().then(() => clearTimeout(watchdog), error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
