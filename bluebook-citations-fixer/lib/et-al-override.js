"use strict";

// Change citeproc input, never the installed CSL or the RTF feature chain.
BCF.etAl = (function () {
    var NS = "http://purl.org/net/xbiblio/csl";
    var api = { PREF: "extensions.bluebook-citations-fixer.etAl.min", SUBSEQUENT_PREF: "extensions.bluebook-citations-fixer.etAl.subsequentMin" };
    var enabled = false, generation = 0, observers = [];
    var deps, patch, diag, ids, lifetime, engineRecord, gate;
    var failures = new Map(), statusRevision = 0;

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
        var keys = ["et-al-min", "et-al-use-first", "et-al-subsequent-min", "et-al-subsequent-use-first"];
        var originals = new Map();
        nodes.forEach(function (node) {
            if (node.getAttribute("et-al-use-last") === "true" ||
                    node.getAttribute("disambiguate-add-names") === "true") {
                throw new Error("Unsupported CSL name options");
            }
            var options = {};
            keys.forEach(function (key) {
                var value = node.getAttribute(key);
                if (value !== null && value !== "" && /^\d+$/.test(value)) options[key] = Number(value);
            });
            originals.set(node, options);
        });
        var citation = nodes.find(function (n) { return n.localName === "citation"; });
        function inherited(node) {
            if (node === root) return Object.assign({}, originals.get(root));
            var parent = node.parentNode;
            // A shared macro has no fixed rendering parent. Resolve its local
            // citation truncation against citation -> style, while real
            // bibliography descendants inherit bibliography -> style. Only
            // first-citation options affect bibliography output. Snapshot all
            // original attributes before editing so traversal cannot change
            // what a later node inherits.
            if (!parent || parent === root || parent.localName === "macro") {
                var base = node.localName === "citation" || node.localName === "bibliography"
                    ? originals.get(root) : Object.assign({}, originals.get(root), originals.get(citation));
                return Object.assign({}, base, originals.get(node));
            }
            return Object.assign(inherited(parent), originals.get(node));
        }
        nodes.forEach(function (node) {
            if (allowed.indexOf(node.localName) === -1) return;
            var own = originals.get(node);
            var scope = node.localName === "citation" || node.localName === "bibliography";
            if (!scope && !keys.some(function (k) { return own[k] !== undefined; })) return;
            var original = inherited(node), bibliography = false;
            for (var ancestor = node; ancestor && ancestor !== root; ancestor = ancestor.parentNode) {
                if (ancestor.localName === "bibliography") bibliography = true;
            }
            var first = minimum || original["et-al-min"];
            var firstCount = minimum ? 1 : original["et-al-use-first"];
            if (minimum) {
                node.setAttribute("et-al-min", String(minimum));
                node.setAttribute("et-al-use-first", "1");
            }
            if (bibliography) return;
            var later = subsequent || original["et-al-subsequent-min"] || first;
            if (!later) return;
            var clamped = first && later > first;
            if (clamped) later = first;
            var laterCount = subsequent || clamped ? 1 : original["et-al-subsequent-use-first"];
            if (laterCount === undefined) laterCount = firstCount;
            // Thresholds alone do not prevent citeproc from expanding the first
            // citation: the retained-name count must not grow on later cites.
            if (firstCount !== undefined && laterCount !== undefined) laterCount = Math.min(laterCount, firstCount);
            node.setAttribute("et-al-subsequent-min", String(later));
            if (laterCount !== undefined) node.setAttribute("et-al-subsequent-use-first", String(laterCount));
        });
        return codec.serialize(doc);
    };

    function defaults() {
        var zot = Zotero;
        function xmlWindow() {
            return zot.getMainWindow() || Services.appShell.hiddenDOMWindow;
        }
        return {
            notify: function () {
                zot.Prefs.set("extensions.bluebook-citations-fixer.etAl.statusRevision", Date.now() + ":" + (++statusRevision), true);
            },
            ready: function () { return zot.Styles.init(); },
            stylePrototype: function () { return zot.Style && zot.Style.prototype; },
            getStyle: function (id) { return zot.Styles.get(id); },
            pref: function (name) { return zot.Prefs.get(name, true); },
            observe: function (fn, name) { return zot.Prefs.registerObserver(name, fn, true); },
            unobserve: function (token) { zot.Prefs.unregisterObserver(token); },
            parse: function (xml) { return new (xmlWindow().DOMParser)().parseFromString(xml, "application/xml"); },
            serialize: function (doc) { return new (xmlWindow().XMLSerializer)().serializeToString(doc); }
        };
    }

    function log(error) { try { diag.err("et-al", error); } catch (_) {} }
    function live() { return enabled && lifetime && lifetime.active; }
    function option(name) { try { return api.option(deps.pref(name)); } catch (_) { return 0; } }
    function notifyStatus() { try { if (deps) deps.notify(); } catch (e) { log(e); } }
    function clearStatus(id) {
        var changed = id ? failures.delete(id) : failures.size > 0;
        if (!id) failures.clear();
        if (changed) notifyStatus();
    }
    function recordFailure(style, id, mode, reader, error) {
        if (!live()) return;
        var reason = error && error.message === "Unsupported CSL name options" ? "unsupported name options in this style version" : "style could not be prepared";
        var prior = failures.get(id);
        failures.set(id, { style: style, mode: mode, reader: reader, reason: reason });
        if (!prior || prior.style !== style || prior.mode !== mode || prior.reader !== reader || prior.reason !== reason) notifyStatus();
    }
    api.status = function () {
        if (!live() || (!option(api.PREF) && !option(api.SUBSEQUENT_PREF))) return [];
        var mode = option(api.PREF) + ":" + option(api.SUBSEQUENT_PREF), result = [];
        failures.forEach(function (failure, id) {
            // Messages describe the current installed revision and preference
            // mode, never an obsolete failure after replacement or disable.
            try {
                var style = deps.getStyle(id);
                if (failure.mode !== mode || style !== failure.style || style.getXML !== failure.reader) {
                    failures.delete(id); return;
                }
                result.push({ id: id, title: style.title || id, reason: failure.reason });
            } catch (_) { failures.delete(id); }
        });
        return result;
    };

    function clearCaches(d, styleIDs) {
        styleIDs.forEach(function (id) {
            try {
                var style = d.getStyle(id);
                // Zotero 7 has no optional global engine cache.
                if (style && typeof style.clearEngineCache === "function") style.clearEngineCache();
            } catch (e) { log(e); }
        });
    }

    function requestReset() {
        var d = deps, styleIDs = ids.slice();
        return gate.requestReset(async function () { await d.ready(); clearCaches(d, styleIDs); });
    }
    api.whenSettled = function () { return gate ? gate.whenSettled() : Promise.resolve(); };

    api.install = async function (injected) {
        if (enabled) return api.whenSettled();
        enabled = true;
        var gen = ++generation;
        patch = BCF.patch;
        diag = BCF.diag;
        gate = BCF.styleGate;
        lifetime = patch._lifetime;
        ids = Array.isArray(patch.BUILTIN_STYLE_IDS) ? patch.BUILTIN_STYLE_IDS.slice() : [];
        deps = Object.assign(defaults(), injected || {});
        var d = deps;
        try {
            await d.ready();
            if (!live() || gen !== generation) return;
            var proto = d.stylePrototype();
            if (!proto || typeof proto.getCiteProc !== "function") throw new Error("Zotero style engine API unavailable");
            var cacheModes = new WeakMap(), rewrittenXML = new WeakMap(), temporaryReaders = new WeakMap();
            // Zotero 11 Styles.init({reinit:true}) clears its inventory and
            // constructs new Style objects (_readStylesFromDirectory). A new
            // installed revision therefore gets a new WeakMap key. Also track
            // the reader identity so a foreign getXML replacement is honored.

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
                        rewrittenXML.delete(style);
                    }
                    if (!minimum && !subsequent) { clearStatus(styleID); return original.apply(style, arguments); }
                    var descriptor, replacement, previous;
                    try {
                        previous = style.getXML;
                        var reader = temporaryReaders.get(previous) || previous;
                        var cached = rewrittenXML.get(style);
                        if (!cached || cached.mode !== mode || cached.reader !== reader || cached.styleID !== styleID) {
                            cached = { mode: mode, styleID: styleID, reader: reader,
                                xml: api.rewriteXML(reader.call(style), minimum, styleID, d, subsequent) };
                            rewrittenXML.set(style, cached);
                        }
                        var rewritten = cached.xml;
                        descriptor = Object.getOwnPropertyDescriptor(style, "getXML");
                        replacement = function () { return rewritten; };
                        temporaryReaders.set(replacement, reader);
                        Object.defineProperty(style, "getXML", { value: replacement, configurable: true, writable: true });
                        clearStatus(styleID);
                    } catch (e) {
                        recordFailure(style, styleID, mode, previous, e);
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
            observers = [api.PREF, api.SUBSEQUENT_PREF].map(function (name) {
                return d.observe(function () {
                    if (!live()) return;
                    clearStatus();
                    clearCaches(d, ids);
                    requestReset().catch(log);
                }, name);
            });
            clearCaches(d, ids);
            return await requestReset();
        } catch (e) { log(e); }
    };

    api.uninstall = function (appShutdown) {
        if (!enabled) return Promise.resolve();
        enabled = false;
        clearStatus();
        generation++;
        observers.forEach(function (token) { try { deps.unobserve(token); } catch (e) { log(e); } });
        observers = [];
        var hadEngine = !!engineRecord;
        if (engineRecord) { try { patch._release(engineRecord); } catch (e) { log(e); } }
        engineRecord = null;
        // The independent gate stays installed until bootstrap has awaited
        // this cleanup, including on disable and hot upgrade.
        if (appShutdown) return Promise.resolve();
        if (!hadEngine) return api.whenSettled();
        clearCaches(deps, ids);
        return requestReset();
    };
    return api;
})();
