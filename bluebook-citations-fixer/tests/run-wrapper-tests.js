"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
// Optional source path lets a regression be checked against a prior revision.
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, "../lib/patch.js"), "utf8");

function fixture() {
    const calls = [];
    const original = name => function (...args) {
        calls.push({ name, receiver: this, args, flag: this.__bcfPrewriteActive });
        return name === "setText" ? args[0] : name;
    };
    const Integration = { Field: function () {}, Session: function () {},
        currentDoc: true, execCommand: original("execCommand") };
    Integration.Field.prototype.setText = original("setText");
    for (const name of ["updateDocument", "writeDelayedCitation", "_updateDocument"]) {
        Integration.Session.prototype[name] = original(name);
    }
    const rawProto = {};
    for (const name of ["setText", "setCode", "getText", "getCode", "delete", "removeCode"]) {
        rawProto[name] = original("raw." + name);
    }
    const raw = Object.create(rawProto);
    const field = new Integration.Field();
    const session = new Integration.Session();
    session.outputFormat = "rtf";
    session._fields = [raw];
    const seams = [[Integration.Field.prototype, "setText"], [Integration, "execCommand"],
        ...["updateDocument", "writeDelayedCitation", "_updateDocument"].map(n => [Integration.Session.prototype, n]),
        ...Object.keys(rawProto).map(n => [rawProto, n])];
    return { Integration, calls, raw, field, session, seams };
}

function instance(f, timers = []) {
    const count = { rewrite: 0, prepare: 0, clear: 0, inspect: 0, events: 0 };
    const context = { BCF: { diag: { enabled: true,
        event() { count.events++; }, err() {} },
        run: { clearSession() { count.clear++; } } },
        Zotero: { Integration: f.Integration }, Components: {
            classes: { "@mozilla.org/timer;1": { createInstance() { return {
                initWithCallback(callback) { timers.push(callback); }, cancel() {}
            }; } } }, interfaces: { nsITimer: { TYPE_ONE_SHOT: 0 } } } };
    vm.createContext(context);
    vm.runInContext(source, context);
    const patch = context.BCF.patch;
    patch.run = async (_field, text) => { count.rewrite++; return text + "!"; };
    patch._prepareCitationTexts = () => { count.prepare++; return true; };
    patch._inspectLiveSession = () => { count.inspect++; };
    patch.install();
    patch._instrumentField(f.raw, "fixture");
    return { patch, context, count };
}

async function exercise(f, active) {
    const start = f.calls.length;
    assert.strictEqual(await f.field.setText("text", false, "extra"), active ? "text!" : "text");
    const written = f.calls[start];
    assert.strictEqual(written.receiver, f.field);
    assert.deepStrictEqual(written.args, [active ? "text!" : "text", false, "extra"]);
    assert.strictEqual(await f.Integration.execCommand("agent", "refresh"), "execCommand");
    assert.strictEqual(await f.session.updateDocument("u"), "updateDocument");
    assert.strictEqual(await f.session.writeDelayedCitation(f.field, { citationID: "id" }), "writeDelayedCitation");
    assert.strictEqual(await f.session._updateDocument("i"), "_updateDocument");
    const internal = f.calls.findLast(c => c.name === "_updateDocument");
    assert.strictEqual(!!internal.flag, active);
    for (const name of ["setText", "setCode", "getText", "getCode", "delete", "removeCode"]) {
        assert.strictEqual(f.raw[name]("raw"), "raw." + name);
    }
    assert.strictEqual(f.calls.length - start, f.seams.length, "original methods must execute exactly once");
}

async function main() {
    // Foreign wrappers survive ordinary teardown and interrupted upgrades.
    for (const interrupted of [false, true]) {
        const f = fixture();
        const first = instance(f);
        await exercise(f, true);
        assert.strictEqual(first.count.rewrite, 1);
        const foreignCalls = [];
        const foreign = f.seams.map(([target, name]) => {
            const prior = target[name];
            const fn = function (...args) { foreignCalls.push(name); return prior.apply(this, args); };
            target[name] = fn;
            return fn;
        });
        if (!interrupted) {
            first.patch.uninstall();
            f.seams.forEach(([target, name], i) => assert.strictEqual(target[name], foreign[i]));
            first.context.BCF = null;
            await exercise(f, false);
        }
        const before = { ...first.count };
        const second = instance(f);
        first.context.BCF = null;
        const foreignBefore = foreignCalls.length;
        await exercise(f, true);
        assert.deepStrictEqual(first.count, before, "retired instance still performs work");
        assert.strictEqual(second.count.rewrite, 1);
        assert.strictEqual(second.count.prepare, 1);
        assert.strictEqual(second.count.clear, 1);
        assert.strictEqual(second.count.inspect, 1);
        assert.strictEqual(foreignCalls.length - foreignBefore, f.seams.length);
        second.patch.uninstall();
        second.context.BCF = null;
        f.seams.forEach(([target, name], i) => assert.strictEqual(target[name], foreign[i]));
        const secondBefore = { ...second.count };
        await exercise(f, false);
        assert.deepStrictEqual(second.count, secondBefore);
    }

    // Replacing rather than wrapping a method must not silently disable BCF
    // on reinstall, nor resurrect the original method it intentionally replaced.
    {
        const f = fixture();
        const first = instance(f);
        const replacement = function (text) { return "replacement:" + text; };
        f.Integration.Field.prototype.setText = replacement;
        first.patch.uninstall();
        const second = instance(f);
        assert.strictEqual(await f.field.setText("x"), "replacement:x!");
        assert.strictEqual(first.count.rewrite, 0);
        second.patch.uninstall();
        assert.strictEqual(f.Integration.Field.prototype.setText, replacement);
    }

    // A directly exposed stale wrapper is positively identified and recovered.
    // An old instance shutting down late cannot remove its successor's hooks.
    {
        const f = fixture();
        const originals = f.seams.map(([target, name]) => target[name]);
        const first = instance(f);
        const second = instance(f);
        first.patch.uninstall();
        first.context.BCF = null;
        await exercise(f, true);
        assert.strictEqual(first.count.rewrite, 0);
        second.patch.uninstall();
        f.seams.forEach(([target, name], i) => assert.strictEqual(target[name], originals[i]));
    }

    // Legacy flags cannot prove that the current function belongs to BCF.
    {
        const f = fixture();
        const foreign = f.Integration.Field.prototype.setText;
        f.Integration.Field.prototype.__lcfPatched = true;
        f.Integration.Field.prototype.__bcfOrigSetText = () => { throw new Error("must not restore"); };
        const current = instance(f);
        assert.strictEqual(f.Integration.Field.prototype.setText, foreign);
        current.patch.uninstall();
        assert.strictEqual(f.Integration.Field.prototype.setText, foreign);
    }

    // A write already waiting on our async rewrite still completes after unload.
    {
        const f = fixture();
        const current = instance(f);
        let finish;
        current.patch.run = () => new Promise(resolve => { finish = resolve; });
        const pending = f.field.setText("before", true);
        await Promise.resolve();
        current.patch.uninstall();
        current.context.BCF = null;
        finish("after");
        assert.strictEqual(await pending, "after");
        assert.strictEqual(f.calls.length, 1);
        assert.deepStrictEqual(f.calls[0].args, ["after", true]);
    }

    // Unload before the rewrite microtask starts skips feature work entirely.
    {
        const f = fixture();
        const current = instance(f);
        const pending = f.field.setText("before", false);
        current.patch.uninstall();
        current.context.BCF = null;
        assert.strictEqual(await pending, "before");
        assert.strictEqual(current.count.rewrite, 0);
    }

    // Pending original methods preserve their result/rejection across teardown.
    for (const [seamIndex, rejecting] of [[1, false], [2, true], [3, false], [4, true]]) {
        const f = fixture();
        const [target, name] = f.seams[seamIndex];
        let settle;
        const failure = new Error("original failure");
        target[name] = () => new Promise((resolve, reject) => {
            settle = () => rejecting ? reject(failure) : resolve("finished");
        });
        const current = instance(f);
        const pending = target[name].call(f.session);
        current.patch.uninstall();
        const before = { ...current.count };
        current.context.BCF = null;
        settle();
        if (rejecting) await assert.rejects(pending, error => error === failure);
        else assert.strictEqual(await pending, "finished");
        assert.deepStrictEqual(current.count, before);
        if (name === "_updateDocument") assert.strictEqual(f.session.__bcfPrewriteActive, false);
    }

    // An interrupted partial install cannot retry after its successor takes over.
    {
        const f = fixture();
        const Session = f.Integration.Session;
        f.Integration.Session = undefined;
        const timers = [];
        const first = instance(f, timers);
        assert.strictEqual(timers.length, 1);
        f.Integration.Session = Session;
        const second = instance(f);
        first.context.BCF = null;
        timers[0].notify();
        await exercise(f, true);
        assert.strictEqual(first.count.rewrite, 0);
        assert.strictEqual(second.count.rewrite, 1);
        second.patch.uninstall();
    }

    // Disabling/re-enabling diagnostics and reusing the same plugin instance
    // must retain retirement tracking for wrappers installed after the toggle.
    {
        const f = fixture();
        const first = instance(f);
        first.patch._uninstrumentFields();
        first.patch._instrumentField(f.raw, "again");
        first.patch.uninstall();
        first.patch.install();
        first.patch._instrumentField(f.raw, "reinstalled");
        const second = instance(f);
        const before = { ...first.count };
        first.context.BCF = null;
        await exercise(f, true);
        assert.deepStrictEqual(first.count, before);
        second.patch.uninstall();
    }
    console.log("bluebook-citations-fixer wrapper tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
