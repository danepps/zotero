"use strict";

// Serialize plugin-owned style mutations independently of author overrides.
BCF.styleGate = (function () {
    var api = {}, enabled = false, retry = null;
    var deps, patch, diag, lifetime, commandRecord, resetRecord, coordinator;
    function defaults() {
        var zot = Zotero;
        return {
            integration: function () { return zot.Integration; },
            // Migration only. Missing Style APIs do not prevent gate startup.
            stylePrototype: function () { return zot.Style && zot.Style.prototype; },
            commandActive: function () { return !!(zot.Integration && zot.Integration.currentDoc); },
            commandPromise: function () { return zot.Integration && zot.Integration.currentCommandPromise; },
            reset: function () { return zot.Integration.resetSessionStyles(); },
            delay: function () { return zot.Promise.delay(100); },
            timer: function (fn) {
                var timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
                timer.initWithCallback({ notify: fn }, 1000, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
                return timer;
            }
        };
    }
    function log(error) { try { diag.err("style-gate", error); } catch (_) {} }
    function live() { return enabled && lifetime && lifetime.active; }

    // One shared gate for engine resets AND complete asynchronous style
    // installations. It is armed synchronously before any new command can
    // start, and stays armed until every queued mutation has settled.
    async function waitForCommands(c, d, current) {
        while (current()) {
            if (c.commands.size) {
                await Promise.all(Array.from(c.commands));
                continue;
            }
            if (!d.commandActive()) return true;
            var pending = d.commandPromise();
            if (pending && typeof pending.then === "function") {
                try { await pending; } catch (_) {}
            }
            if (current() && d.commandActive()) await d.delay();
        }
        return false;
    }

    function drain(c) {
        if (c.promise) {
            // A previous plugin generation may still be running the original
            // reset-only drain. Resume our new tasks when that drain finishes.
            c.promise.then(function () {
                if (c.tasks.length || c.job) drain(c);
            });
            return c.promise;
        }
        c.promise = Promise.resolve().then(async function () {
            while (c.tasks.length || c.job) {
                var job;
                if (c.tasks.length) job = c.tasks.shift();
                else { job = c.job; c.job = null; }
                try { await job(); } catch (e) { log(e); }
            }
            c.promise = null;
        });
        return c.promise;
    }

    // Styles.reinit() starts resetSessionStyles() without awaiting it. Observe
    // its actual promise, including settled failures, rather than treating the
    // installer promise as proof that every document engine has been rebuilt.
    async function settleResets(pending) {
        var failure = null;
        while (pending.size) {
            var batch = Array.from(pending);
            var results = await Promise.all(batch);
            batch.forEach(function (p) { pending.delete(p); });
            results.forEach(function (r) { if (r.failed && !failure) failure = r; });
        }
        return failure;
    }

    async function withNativeResets(c, task) {
        var scope = new Set(c.resets), result, failure = null;
        c.resetScope = scope;
        try {
            var prior = await settleResets(scope);
            if (prior) throw prior.error;
            result = await task();
        } catch (e) { failure = { error: e }; }
        finally {
            // Also wait after a failed install or cancellation. Errors must not
            // release commands while another native reset is still running.
            var resetFailure = await settleResets(scope);
            if (!failure && resetFailure) failure = resetFailure;
            if (c.resetScope === scope) c.resetScope = null;
        }
        if (failure) throw failure.error;
        return result;
    }

    api.requestReset = function (clearFn) {
        if (!coordinator || !commandRecord || !resetRecord) return Promise.reject(new Error("Style-change command gate unavailable"));
        var c = coordinator, d = deps;
        var revision = ++c.revision;
        c.resetOwner = lifetime;
        c.job = async function () {
            if (!await waitForCommands(c, d, function () { return revision === c.revision; }) || revision !== c.revision) return;
            await withNativeResets(c, async function () {
                if (revision !== c.revision) return;
                if (clearFn) await clearFn();
                if (revision === c.revision) await d.reset();
            });
        };
        c.job.owner = lifetime;
        return drain(c);
    };

    api.withStyleChange = function (task, current) {
        // Never fall back to an unguarded install if hook setup failed.
        if (!live() || !coordinator || !commandRecord || !resetRecord) {
            return Promise.reject(new Error("Style-change command gate unavailable"));
        }
        var c = coordinator, d = deps;
        function allowed() { return live() && (!current || current()); }
        var result = new Promise(function (resolve, reject) {
            c.tasks.push(async function () {
                try {
                    if (!await waitForCommands(c, d, allowed) || !allowed()) { resolve(undefined); return; }
                    // Once task starts, retain the gate through its awaits even
                    // if disable/upgrade cancels later work and notifications.
                    resolve(await withNativeResets(c, function () {
                        return allowed() ? task() : undefined;
                    }));
                } catch (e) { reject(e); }
            });
        });
        drain(c);
        return result;
    };
    api.whenSettled = async function () {
        while (coordinator && (coordinator.promise || coordinator.resets.size)) {
            if (coordinator.promise) await coordinator.promise;
            var failure = await settleResets(coordinator.resets);
            if (failure) log(failure.error);
        }
    };

    function installCommandHook() {
        if (!live() || (commandRecord && resetRecord)) return;
        var integration = deps.integration();
        if (!integration || typeof integration.execCommand !== "function" ||
                typeof integration.resetSessionStyles !== "function") {
            retry = deps.timer(function () { retry = null; installCommandHook(); });
            return;
        }
        prepareCoordinator(integration);
        var c = coordinator;
        // Keep the historical wrapper keys so hot upgrades retire the exact
        // old dispatchers, including wrappers buried under foreign handlers.
        if (!resetRecord) resetRecord = patch._wrap(integration, "resetSessionStyles", "etAl.resetSessionStyles", function (original) {
            return function () {
                var result = original.apply(this, arguments);
                var observed = Promise.resolve(result).then(function () { return { failed: false }; },
                    function (error) { log(error); return { failed: true, error: error }; });
                c.resets.add(observed);
                if (c.resetScope) c.resetScope.add(observed);
                observed.then(function () { c.resets.delete(observed); });
                return result;
            };
        });
        if (!commandRecord) commandRecord = patch._wrap(integration, "execCommand", "etAl.execCommand", function (original) {
            return async function () {
                while (c.promise) await c.promise;
                var finish;
                var pending = new Promise(function (resolve) { finish = resolve; });
                c.commands.add(pending);
                try { return await original.apply(this, arguments); }
                finally { c.commands.delete(pending); finish(); }
            };
        });
    }

    function prepareCoordinator(integration) {
        var proto = deps.stylePrototype();
        coordinator = integration.__bcfStyleGate || (proto && proto.__bcfEtAlCoordinator);
        if (!coordinator) coordinator = { commands: new Set(), promise: null, job: null, revision: 0, tasks: [] };
        Object.defineProperty(integration, "__bcfStyleGate", { value: coordinator, configurable: true });
        if (proto && proto.__bcfEtAlCoordinator === coordinator) delete proto.__bcfEtAlCoordinator;
        if (!coordinator.tasks) coordinator.tasks = [];
        if (!coordinator.resets) coordinator.resets = new Set();
    }

    api.install = function (injected) {
        if (enabled) return;
        enabled = true;
        patch = BCF.patch; diag = BCF.diag; lifetime = patch._lifetime;
        deps = Object.assign(defaults(), injected || {});
        // No await before adoption and wrapper installation: old pending tasks
        // must hold commands even during a replacement generation's startup.
        installCommandHook();
    };
    api.uninstall = async function (appShutdown) {
        if (!enabled) return api.whenSettled();
        enabled = false;
        if (retry) { try { retry.cancel(); } catch (_) {} retry = null; }
        if (appShutdown && coordinator && coordinator.resetOwner === lifetime) {
            coordinator.revision++; coordinator.job = null;
        }
        await api.whenSettled();
        if (resetRecord) patch._release(resetRecord);
        if (commandRecord) patch._release(commandRecord);
        resetRecord = commandRecord = null;
    };
    return api;
})();
