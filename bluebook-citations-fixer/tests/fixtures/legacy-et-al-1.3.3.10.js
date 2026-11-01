"use strict";

// Change citeproc input, never the installed CSL or the RTF feature chain.
BCF.etAl = (function () {
    var NS = "http://purl.org/net/xbiblio/csl";
    var api = { PREF: "extensions.bluebook-citations-fixer.etAl.min", SUBSEQUENT_PREF: "extensions.bluebook-citations-fixer.etAl.subsequentMin" };
    var enabled = false, generation = 0, observers = [], retry = null;
    var deps, patch, diag, ids, lifetime, engineRecord, commandRecord, resetRecord, coordinator;

    api.option = function (value) {
        return Number.isInteger(value) && value >= 3 && value <= 11 ? value : 0;
    };

    api.rewriteXML = function (xml, minimum, expectedID, codec, subsequent) {
        minimum = api.option(minimum);
        subsequent = api.option(subsequent);
        if (!minimum && !subsequent) return xml;
        var doc = codec.parse(xml);
        var root = doc && doc.documentElement;
        if (!root || root.namespaceURI !== NS || root.localName !== "style" ||
                doc.getElementsByTagName("parsererror").length) throw new Error("Invalid CSL XML");
        var info = Array.from(root.childNodes).find(function (n) { return n.namespaceURI === NS && n.localName === "info"; });
        var id = info && Array.from(info.childNodes).find(function (n) { return n.namespaceURI === NS && n.localName === "id"; });
        if (!id || id.textContent.trim() !== expectedID) throw new Error("CSL style ID mismatch");
        var nodes = [root].concat(Array.from(root.getElementsByTagNameNS(NS, "*")));
        var allowed = ["style", "citation", "bibliography", "names", "name"];
        var rootMin = root.getAttribute("et-al-subsequent-min") || root.getAttribute("et-al-min");
        var rootFirst = root.getAttribute("et-al-subsequent-use-first") || root.getAttribute("et-al-use-first");
        nodes.forEach(function (node) {
            if (node.getAttribute("et-al-use-last") === "true" ||
                    node.getAttribute("disambiguate-add-names") === "true") {
                throw new Error("Unsupported CSL name options");
            }
            if (allowed.indexOf(node.localName) === -1) return;
            var isBibliography = node.localName === "bibliography";
            var base = node.hasAttribute("et-al-min") || node.hasAttribute("et-al-use-first");
            var scope = node.localName === "citation" || isBibliography;
            // Preserve the installed subsequent default when only the first
            // threshold changes, including styles that relied on inheritance.
            if (!isBibliography && (scope || base || node.hasAttribute("et-al-subsequent-min"))) {
                var originalMin = node.getAttribute("et-al-subsequent-min") || node.getAttribute("et-al-min") ||
                    rootMin;
                var originalFirst = node.getAttribute("et-al-subsequent-use-first") || node.getAttribute("et-al-use-first") ||
                    rootFirst;
                if (subsequent || originalMin) node.setAttribute("et-al-subsequent-min", String(subsequent || originalMin));
                if (subsequent || originalFirst) node.setAttribute("et-al-subsequent-use-first", subsequent ? "1" : originalFirst);
            }
            if (minimum && (scope || base)) {
                node.setAttribute("et-al-min", String(minimum));
                node.setAttribute("et-al-use-first", "1");
            }
        });
        return codec.serialize(doc);
    };

    function defaults() {
        var zot = Zotero;
        function xmlWindow() {
            return zot.getMainWindow() || Services.appShell.hiddenDOMWindow;
        }
        return {
            ready: function () { return zot.Styles.init(); },
            stylePrototype: function () { return zot.Style && zot.Style.prototype; },
            integration: function () { return zot.Integration; },
            getStyle: function (id) { return zot.Styles.get(id); },
            pref: function (name) { return zot.Prefs.get(name, true); },
            observe: function (fn, name) { return zot.Prefs.registerObserver(name, fn, true); },
            unobserve: function (token) { zot.Prefs.unregisterObserver(token); },
            commandActive: function () { return !!(zot.Integration && zot.Integration.currentDoc); },
            commandPromise: function () { return zot.Integration && zot.Integration.currentCommandPromise; },
            reset: function () { return zot.Integration && zot.Integration.resetSessionStyles(); },
            delay: function () { return zot.Promise.delay(100); },
            timer: function (fn) {
                var timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
                timer.initWithCallback({ notify: fn }, 1000, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
                return timer;
            },
            parse: function (xml) { return new (xmlWindow().DOMParser)().parseFromString(xml, "application/xml"); },
            serialize: function (doc) { return new (xmlWindow().XMLSerializer)().serializeToString(doc); }
        };
    }

    function log(error) { try { diag.err("et-al", error); } catch (_) {} }
    function live() { return enabled && lifetime && lifetime.active; }
    function option(name) { try { return api.option(deps.pref(name)); } catch (_) { return 0; } }
    function clearCaches(d, styleIDs) {
        styleIDs.forEach(function (id) {
            try {
                var style = d.getStyle(id);
                // Zotero 7 has no optional global engine cache.
                if (style && typeof style.clearEngineCache === "function") style.clearEngineCache();
            } catch (e) { log(e); }
        });
    }

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

    function requestReset() {
        if (!coordinator) return Promise.resolve();
        var c = coordinator, d = deps, styleIDs = ids.slice();
        var revision = ++c.revision;
        c.job = async function () {
            await d.ready();
            if (!await waitForCommands(c, d, function () { return revision === c.revision; }) || revision !== c.revision) return;
            await withNativeResets(c, async function () {
                if (revision !== c.revision) return;
                clearCaches(d, styleIDs);
                await d.reset();
            });
        };
        return drain(c);
    }

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
        var c = coordinator;
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

    function prepareCoordinator(proto) {
        coordinator = proto.__bcfEtAlCoordinator;
        if (!coordinator) {
            coordinator = { commands: new Set(), promise: null, job: null, revision: 0, tasks: [] };
            Object.defineProperty(proto, "__bcfEtAlCoordinator", { value: coordinator, configurable: true });
        }
        if (!coordinator.tasks) coordinator.tasks = [];
        if (!coordinator.resets) coordinator.resets = new Set();
    }

    api.install = async function (injected) {
        if (enabled) return api.whenSettled();
        enabled = true;
        var gen = ++generation;
        patch = BCF.patch;
        diag = BCF.diag;
        lifetime = patch._lifetime;
        ids = Array.isArray(patch.BUILTIN_STYLE_IDS) ? patch.BUILTIN_STYLE_IDS.slice() : [];
        deps = Object.assign(defaults(), injected || {});
        var d = deps;
        try {
            // On hot upgrade the prior Style prototype already exists. Adopt
            // its gate synchronously: patch.install just retired old wrappers,
            // so awaiting Styles.init first would reopen the command seam.
            var earlyProto = d.stylePrototype();
            if (earlyProto) { prepareCoordinator(earlyProto); installCommandHook(); }
            await d.ready();
            if (!live() || gen !== generation) return;
            var proto = d.stylePrototype();
            if (!proto || typeof proto.getCiteProc !== "function") throw new Error("Zotero style engine API unavailable");
            prepareCoordinator(proto);
            var cacheModes = new WeakMap();
            engineRecord = patch._wrap(proto, "getCiteProc", "etAl.getCiteProc", function (original) {
                return function () {
                    var style = this;
                    // Style identity is strict even when the RTF gate is open.
                    var styleID;
                    try { styleID = style.styleID; } catch (_) { return original.apply(style, arguments); }
                    if (!live() || ids.indexOf(styleID) === -1) return original.apply(style, arguments);
                    var minimum = option(api.PREF), subsequent = option(api.SUBSEQUENT_PREF);
                    var mode = minimum + ":" + subsequent;
                    if (cacheModes.get(style) !== mode) {
                        try {
                            if (typeof style.clearEngineCache === "function") style.clearEngineCache();
                        } catch (e) { log(e); return original.apply(style, arguments); }
                        cacheModes.set(style, mode);
                    }
                    if (!minimum && !subsequent) return original.apply(style, arguments);
                    var descriptor, replacement, previous;
                    try {
                        previous = style.getXML;
                        var xml = previous.call(style);
                        var rewritten = api.rewriteXML(xml, minimum, styleID, d, subsequent);
                        descriptor = Object.getOwnPropertyDescriptor(style, "getXML");
                        replacement = function () { return rewritten; };
                        Object.defineProperty(style, "getXML", { value: replacement, configurable: true, writable: true });
                    } catch (e) {
                        log(e);
                        return original.apply(style, arguments);
                    }
                    // Zotero 7 and the installed Zotero build consume XML and
                    // construct both processor backends synchronously here.
                    // Restore even when construction throws; never retry it.
                    try { return original.apply(style, arguments); }
                    finally {
                        if (style.getXML === replacement) {
                            if (descriptor) Object.defineProperty(style, "getXML", descriptor);
                            else delete style.getXML;
                        }
                    }
                };
            });
            installCommandHook();
            observers = [api.PREF, api.SUBSEQUENT_PREF].map(function (name) {
                return d.observe(function () {
                    if (!live()) return;
                    clearCaches(d, ids);
                    requestReset();
                }, name);
            });
            clearCaches(d, ids);
            return await requestReset();
        } catch (e) { log(e); }
    };

    api.uninstall = function (appShutdown) {
        if (!enabled) return Promise.resolve();
        enabled = false;
        generation++;
        if (retry) { try { retry.cancel(); } catch (_) {} retry = null; }
        observers.forEach(function (token) { try { deps.unobserve(token); } catch (e) { log(e); } });
        observers = [];
        var hadEngine = !!engineRecord;
        if (engineRecord) { try { patch._release(engineRecord); } catch (e) { log(e); } }
        engineRecord = null;
        var gate = commandRecord, resets = resetRecord, owner = patch;
        commandRecord = null;
        resetRecord = null;
        function releaseGate() {
            if (resets) { try { owner._release(resets); } catch (e) { log(e); } }
            if (gate) { try { owner._release(gate); } catch (e) { log(e); } }
        }
        if (appShutdown) {
            if (coordinator) { coordinator.revision++; coordinator.job = null; }
            return api.whenSettled().then(releaseGate);
        }
        if (!coordinator) return Promise.resolve();
        if (!hadEngine) return api.whenSettled().then(releaseGate);
        // Cleanup survives disable: the shared queue rebuilds through whatever
        // hook is current when it runs, never reactivating an obsolete instance.
        clearCaches(deps, ids);
        // Keep the command barrier until teardown resets finish. The bootstrap
        // awaits this before retiring the shared patch wrappers and globals.
        return requestReset().then(releaseGate);
    };
    return api;
})();
